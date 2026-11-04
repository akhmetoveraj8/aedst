//! Triggers and backoff around the drainer.
//!
//! One run at a time; a trigger during a run schedules exactly one more. After a retryable
//! failure the next run waits 2 s, doubling, capped at 5 min, with equal jitter. Nothing here knows
//! about connectivity: the host calls [`OutboxService::trigger`] after `enqueue`, at session start,
//! and when the network comes back (so Outbox does not depend on a connectivity crate).

use std::{
    sync::{
        Arc,
        atomic::{AtomicBool, Ordering},
    },
    time::Duration,
};

use crate::{
    drainer::{Handlers, RunResult, run},
    queue::SqliteOutbox,
};

const BASE_DELAY: Duration = Duration::from_secs(2);
const MAX_DELAY: Duration = Duration::from_secs(5 * 60);

/// Backoff for the n-th consecutive retry (1-based). `jitter` is in `[0, 1)`: the delay is half the
/// exponential value plus `jitter` times the other half ("equal jitter").
#[must_use]
pub fn retry_delay(attempts: u32, jitter: f64) -> Duration {
    let exponent = attempts.saturating_sub(1).min(16);
    let full = BASE_DELAY.saturating_mul(1_u32 << exponent).min(MAX_DELAY);
    full / 2 + full.mul_f64(jitter.clamp(0.0, 1.0) / 2.0)
}

/// Keeps the outbox drained.
pub struct OutboxService {
    queue: SqliteOutbox,
    handlers: Handlers,
    running: AtomicBool,
    again: AtomicBool,
}

impl OutboxService {
    /// A service over `queue` with the features' `handlers`.
    #[must_use]
    pub fn new(queue: SqliteOutbox, handlers: Handlers) -> Arc<Self> {
        Arc::new(Self {
            queue,
            handlers,
            running: AtomicBool::new(false),
            again: AtomicBool::new(false),
        })
    }

    /// Starts a run unless one is active; an active run is told to run once more afterwards.
    pub fn trigger(self: &Arc<Self>) {
        if self.running.swap(true, Ordering::SeqCst) {
            self.again.store(true, Ordering::SeqCst);
            return;
        }
        let service = Arc::clone(self);
        tokio::spawn(async move { service.run_until_settled().await });
    }

    async fn run_until_settled(self: Arc<Self>) {
        loop {
            match run(&self.queue, &self.handlers).await {
                Ok(RunResult::Retry { attempts }) => {
                    tokio::time::sleep(retry_delay(attempts, rand::random::<f64>())).await;
                    continue;
                }
                Ok(RunResult::Complete | RunResult::Blocked) => {}
                Err(error) => tracing::warn!(%error, "outbox run failed"),
            }
            if self.again.swap(false, Ordering::SeqCst) {
                continue;
            }
            self.running.store(false, Ordering::SeqCst);
            // A trigger can land between the check above and the store: do not lose it.
            if self.again.load(Ordering::SeqCst) && !self.running.swap(true, Ordering::SeqCst) {
                self.again.store(false, Ordering::SeqCst);
                continue;
            }
            return;
        }
    }

    /// Items still waiting (for a "waiting to sync" indicator).
    ///
    /// # Errors
    /// Database errors.
    pub async fn pending_count(&self) -> Result<u64, aedst_persistence::PersistenceError> {
        self.queue.pending_count().await
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn backoff_doubles_and_is_capped() {
        assert_eq!(retry_delay(1, 0.0), Duration::from_secs(1));
        assert_eq!(retry_delay(1, 1.0), Duration::from_secs(2));
        assert_eq!(retry_delay(2, 1.0), Duration::from_secs(4));
        assert_eq!(retry_delay(3, 0.0), Duration::from_secs(4));
        assert_eq!(retry_delay(50, 1.0), MAX_DELAY);
        assert_eq!(retry_delay(50, 0.0), MAX_DELAY / 2);
    }
}
