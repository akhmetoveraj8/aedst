//! The inbox view model: owns the state, calls the use cases, publishes an [`InboxView`].
//!
//! No UI types: the Slint glue subscribes to [`InboxController::subscribe`]. A response that belongs
//! to an older load (the user changed the filter or refreshed meanwhile) is discarded, and
//! `Cancelled` never shows an error. Marking read is optimistic and rolls back on failure; the
//! writes are not queued offline, a failure is shown by its kind.

use std::sync::{Arc, Mutex, PoisonError};

use aedst_common::{ErrorKind, PageCursor};
use tokio::sync::watch;

use super::{
    inbox_state::{InboxView, Phase, Row},
    unread::UnreadCounter,
};
use crate::domain::{NotificationQuery, NotificationsService};

#[derive(Default)]
struct Inner {
    view: InboxView,
    /// Epoch, page load in flight and next token; an answer of an older epoch is dropped.
    cursor: PageCursor,
}

/// Drives the inbox screen.
pub struct InboxController {
    service: Arc<NotificationsService>,
    counter: Arc<UnreadCounter>,
    inner: Mutex<Inner>,
    published: watch::Sender<InboxView>,
}

impl InboxController {
    /// A controller over the use cases and the badge counter.
    #[must_use]
    pub fn new(service: Arc<NotificationsService>, counter: Arc<UnreadCounter>) -> Arc<Self> {
        Arc::new(Self {
            service,
            counter,
            inner: Mutex::new(Inner::default()),
            published: watch::channel(InboxView::default()).0,
        })
    }

    /// The UI subscribes here.
    #[must_use]
    pub fn subscribe(&self) -> watch::Receiver<InboxView> {
        self.published.subscribe()
    }

    fn update<T>(&self, work: impl FnOnce(&mut Inner) -> T) -> T {
        let mut inner = self.inner.lock().unwrap_or_else(PoisonError::into_inner);
        let result = work(&mut inner);
        inner.view.loading_more = inner.cursor.loading_more();
        inner.view.has_more = inner.cursor.has_more();
        let view = inner.view.clone();
        drop(inner);
        self.published.send_replace(view);
        result
    }

    /// Loads (or reloads) the first page. Safe to call again: only the latest call wins.
    pub async fn load_first(&self) {
        let (epoch, query) = self.update(|i| {
            i.view.phase = Phase::Loading;
            i.view.action_error = None;
            (
                i.cursor.begin_first(),
                NotificationQuery {
                    unread_only: i.view.unread_only,
                    page_token: None,
                },
            )
        });
        let result = self.service.list(&query).await;
        self.update(|i| {
            if !i.cursor.is_current(epoch) {
                return; // a newer load started while this one was in flight
            }
            match result {
                Ok(page) => {
                    i.view.rows = page
                        .notifications
                        .iter()
                        .map(Row::from_notification)
                        .collect();
                    i.cursor.finish_first(epoch, page.next_page_token);
                    i.view.phase = Phase::Ready;
                }
                Err(ErrorKind::Cancelled) => i.view.phase = Phase::Idle,
                Err(kind) => i.view.phase = Phase::Failed(kind),
            }
        });
    }

    /// Switches the "unread only" filter and reloads from the first page.
    pub async fn set_unread_only(&self, unread_only: bool) {
        let changed = self.update(|i| {
            let changed = i.view.unread_only != unread_only;
            i.view.unread_only = unread_only;
            changed
        });
        if changed {
            self.load_first().await;
        }
    }

    /// Loads the next page, if there is one and none is loading.
    pub async fn load_more(&self) {
        let started = self.update(|i| {
            if i.view.phase != Phase::Ready {
                return None;
            }
            let (epoch, token) = i.cursor.begin_more()?;
            Some((
                epoch,
                NotificationQuery {
                    unread_only: i.view.unread_only,
                    page_token: Some(token),
                },
            ))
        });
        let Some((epoch, query)) = started else {
            return;
        };
        let result = self.service.list(&query).await;
        self.update(|i| match result {
            Ok(page) => {
                if i.cursor.finish_more(epoch, page.next_page_token) {
                    i.view
                        .rows
                        .extend(page.notifications.iter().map(Row::from_notification));
                }
            }
            Err(kind) => {
                if i.cursor.fail_more(epoch) && kind != ErrorKind::Cancelled {
                    i.view.action_error = Some(kind);
                }
            }
        });
    }

    /// Opens a row: navigates to its link and, when it was unread, marks it read. The row and the
    /// badge change at once; a failed call puts both back and shows the kind.
    pub async fn open(&self, id: &str) {
        let Some((link, was_unread)) = self.update(|i| {
            i.view.action_error = None;
            let row = i.view.rows.iter_mut().find(|r| r.id == id)?;
            let was_unread = !row.read;
            row.read = true;
            Some((row.link.clone(), was_unread))
        }) else {
            return;
        };
        if !link.is_empty() && !self.service.open_link(&link) {
            tracing::debug!("notification link was not accepted by any route");
        }
        if !was_unread {
            return;
        }
        self.counter.decrease(1);
        match self.service.mark_read(&[id.to_owned()]).await {
            Ok(()) => {
                let _ = self.counter.refresh().await; // a failed refresh keeps the optimistic count
            }
            Err(kind) => {
                self.update(|i| {
                    if let Some(row) = i.view.rows.iter_mut().find(|r| r.id == id) {
                        row.read = false;
                    }
                    if kind != ErrorKind::Cancelled {
                        i.view.action_error = Some(kind);
                    }
                });
                self.counter
                    .set_local(self.counter.current().saturating_add(1));
            }
        }
    }

    /// Marks everything read. Optimistic; a failure restores the rows and the badge.
    pub async fn mark_all_read(&self) {
        let Some(previously_unread) = self.update(|i| {
            if i.view.marking_all {
                return None;
            }
            i.view.marking_all = true;
            i.view.action_error = None;
            let ids: Vec<String> = i
                .view
                .rows
                .iter()
                .filter(|r| !r.read)
                .map(|r| r.id.clone())
                .collect();
            i.view.rows.iter_mut().for_each(|r| r.read = true);
            Some(ids)
        }) else {
            return;
        };
        let before = self.counter.current();
        self.counter.set_local(0);
        match self.service.mark_all_read().await {
            Ok(_) => {
                let unread_only = self.update(|i| {
                    i.view.marking_all = false;
                    i.view.unread_only
                });
                let _ = self.counter.refresh().await;
                if unread_only {
                    self.load_first().await; // the filtered list is empty now
                }
            }
            Err(kind) => {
                self.update(|i| {
                    i.view.marking_all = false;
                    for row in &mut i.view.rows {
                        if previously_unread.contains(&row.id) {
                            row.read = false;
                        }
                    }
                    if kind != ErrorKind::Cancelled {
                        i.view.action_error = Some(kind);
                    }
                });
                self.counter.set_local(before);
            }
        }
    }
}
