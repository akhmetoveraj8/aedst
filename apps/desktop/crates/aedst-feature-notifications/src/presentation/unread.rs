//! The unread badge: a counter published on a `watch`, refreshed by a poller with backoff and
//! after every mark operation.
//!
//! Desktop has no push channel, so the shell runs [`UnreadCounter::run`] while signed in and
//! aborts the task on sign-out. The numbers are those of the Qt implementation
//! (`NotificationsViewModel`, ADR-0022): 30 s in the foreground, 2 min in the background,
//! doubling per consecutive failure up to a 5 min ceiling.

use std::{
    sync::{
        Arc,
        atomic::{AtomicU64, Ordering},
    },
    time::Duration,
};

use aedst_common::ErrorKind;
use tokio::sync::watch;

use crate::domain::NotificationsService;

/// Poll interval while the window is active.
pub const FOREGROUND_INTERVAL: Duration = Duration::from_secs(30);
/// Poll interval while the window is in the background.
pub const BACKGROUND_INTERVAL: Duration = Duration::from_secs(120);
/// No delay is ever longer than this, however many polls failed.
pub const MAX_BACKOFF: Duration = Duration::from_secs(300);
/// The failure counter stops growing here (the legacy cap of 10).
pub const MAX_FAILURES: u32 = 10;
/// The delay doubles at most this many times (`base << 4`), then the ceiling applies.
pub const MAX_DOUBLINGS: u32 = 4;

/// The delay before the next poll: `base << min(failures, 4)`, capped at [`MAX_BACKOFF`].
/// `consecutive_failures` counts the failed polls in a row including the latest (0 after a
/// success); a success resets it.
#[must_use]
pub fn poll_delay(consecutive_failures: u32, foreground: bool) -> Duration {
    let base = if foreground {
        FOREGROUND_INTERVAL
    } else {
        BACKGROUND_INTERVAL
    };
    let doublings = consecutive_failures.min(MAX_FAILURES).min(MAX_DOUBLINGS);
    base.saturating_mul(1 << doublings).min(MAX_BACKOFF)
}

/// Publishes the unread count for the shell badge.
pub struct UnreadCounter {
    service: Arc<NotificationsService>,
    published: watch::Sender<u32>,
    /// Bumped by every local (optimistic) change; a refresh that started before it is dropped.
    epoch: AtomicU64,
}

impl UnreadCounter {
    /// A counter that starts at zero.
    #[must_use]
    pub fn new(service: Arc<NotificationsService>) -> Arc<Self> {
        Arc::new(Self {
            service,
            published: watch::channel(0).0,
            epoch: AtomicU64::new(0),
        })
    }

    /// The badge subscribes here.
    #[must_use]
    pub fn subscribe(&self) -> watch::Receiver<u32> {
        self.published.subscribe()
    }

    /// The count now.
    #[must_use]
    pub fn current(&self) -> u32 {
        *self.published.borrow()
    }

    /// Shows `count` immediately (an optimistic change or its rollback). A refresh already in
    /// flight is dropped because it may predate this change.
    pub fn set_local(&self, count: u32) {
        self.epoch.fetch_add(1, Ordering::SeqCst);
        self.published.send_replace(count);
    }

    /// Lowers the count by `by`, never below zero.
    pub fn decrease(&self, by: u32) {
        self.set_local(self.current().saturating_sub(by));
    }

    /// Asks the server and publishes the answer.
    ///
    /// # Errors
    /// The failure kind; the shown count stays as it was.
    pub async fn refresh(&self) -> Result<u32, ErrorKind> {
        let epoch = self.epoch.load(Ordering::SeqCst);
        let count = self.service.unread_count().await?;
        if self.epoch.load(Ordering::SeqCst) == epoch {
            self.published.send_replace(count);
        }
        Ok(count)
    }

    /// Polls until the task is aborted or `foreground` is dropped. The first poll is immediate;
    /// coming to the foreground polls at once. A session that is over (`Unauthenticated`) or a
    /// build that is too old (`UpgradeRequired`) ends the loop: the shell restarts it after sign-in.
    pub async fn run(&self, mut foreground: watch::Receiver<bool>) {
        let mut failures = 0_u32;
        loop {
            match self.refresh().await {
                Ok(_) => failures = 0,
                Err(ErrorKind::Cancelled) => {}
                Err(ErrorKind::Unauthenticated | ErrorKind::UpgradeRequired) => return,
                Err(kind) => {
                    failures = (failures + 1).min(MAX_FAILURES);
                    tracing::debug!(kind = kind.name(), failures, "unread poll failed");
                }
            }
            loop {
                let delay = poll_delay(failures, *foreground.borrow());
                tokio::select! {
                    () = tokio::time::sleep(delay) => break,
                    changed = foreground.changed() => {
                        if changed.is_err() {
                            return;
                        }
                        if *foreground.borrow() {
                            break; // the user came back: catch up now
                        }
                    }
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const fn secs(s: u64) -> Duration {
        Duration::from_secs(s)
    }

    #[test]
    fn no_failures_polls_at_the_base_interval() {
        assert_eq!(poll_delay(0, true), secs(30));
        assert_eq!(poll_delay(0, false), secs(120));
    }

    #[test]
    fn each_failure_doubles_the_delay_up_to_the_ceiling() {
        let foreground: Vec<_> = (0..=6).map(|n| poll_delay(n, true)).collect();
        assert_eq!(
            foreground,
            [30, 60, 120, 240, 300, 300, 300].map(secs).to_vec()
        );
        let background: Vec<_> = (0..=3).map(|n| poll_delay(n, false)).collect();
        assert_eq!(background, [120, 240, 300, 300].map(secs).to_vec());
    }

    #[test]
    fn a_huge_failure_count_neither_overflows_nor_exceeds_the_ceiling() {
        assert_eq!(poll_delay(u32::MAX, true), MAX_BACKOFF);
        assert_eq!(poll_delay(u32::MAX, false), MAX_BACKOFF);
    }
}
