//! What the domain needs from the outside world. `data` implements these; tests use fakes.

use aedst_common::ErrorKind;
use futures::future::BoxFuture;

use super::notification::{NotificationPage, NotificationQuery, Preferences};

/// The server side of Notifications. Writes carry the `Idempotency-Key`. None of them is queued
/// offline: a failure is shown by its kind.
pub trait NotificationsRepository: Send + Sync {
    /// One page of the inbox.
    fn list<'a>(
        &'a self,
        query: &'a NotificationQuery,
    ) -> BoxFuture<'a, Result<NotificationPage, ErrorKind>>;
    /// The number of unread entries.
    fn unread_count(&self) -> BoxFuture<'_, Result<u32, ErrorKind>>;
    /// Marks the given entries (1 to 100 ids) as read.
    fn mark_read<'a>(
        &'a self,
        ids: &'a [String],
        key: &'a str,
    ) -> BoxFuture<'a, Result<(), ErrorKind>>;
    /// Marks every entry as read; returns how many changed.
    fn mark_all_read<'a>(&'a self, key: &'a str) -> BoxFuture<'a, Result<u32, ErrorKind>>;
    /// The delivery switches.
    fn get_preferences(&self) -> BoxFuture<'_, Result<Preferences, ErrorKind>>;
    /// Replaces the delivery switches; returns what the server stored.
    fn update_preferences<'a>(
        &'a self,
        preferences: &'a Preferences,
        key: &'a str,
    ) -> BoxFuture<'a, Result<Preferences, ErrorKind>>;
}

/// Opens an in-app link of a notification. The shell wires `aedst_navigation::Router::open_link`.
pub trait LinkNavigator: Send + Sync {
    /// True when the link was accepted by a registered route.
    fn open(&self, link: &str) -> bool;
}
