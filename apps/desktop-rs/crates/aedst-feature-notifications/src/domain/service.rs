//! The use cases. Reads go straight to the repository; every write gets a fresh `Idempotency-Key`.

use std::sync::Arc;

use aedst_common::ErrorKind;

use super::{
    notification::{MAX_MARK_IDS, NotificationPage, NotificationQuery, Preferences},
    ports::{LinkNavigator, NotificationsRepository},
};

/// Notifications use cases over the ports.
pub struct NotificationsService {
    repository: Arc<dyn NotificationsRepository>,
    navigator: Arc<dyn LinkNavigator>,
    new_key: Box<dyn Fn() -> String + Send + Sync>,
}

impl NotificationsService {
    /// `new_key` makes a fresh idempotency key (a UUID in production).
    #[must_use]
    pub fn new(
        repository: Arc<dyn NotificationsRepository>,
        navigator: Arc<dyn LinkNavigator>,
        new_key: impl Fn() -> String + Send + Sync + 'static,
    ) -> Self {
        Self {
            repository,
            navigator,
            new_key: Box::new(new_key),
        }
    }

    /// One page of the inbox.
    ///
    /// # Errors
    /// The failure kind.
    pub async fn list(&self, query: &NotificationQuery) -> Result<NotificationPage, ErrorKind> {
        self.repository.list(query).await
    }

    /// The unread count.
    ///
    /// # Errors
    /// The failure kind.
    pub async fn unread_count(&self) -> Result<u32, ErrorKind> {
        self.repository.unread_count().await
    }

    /// Marks entries read, in chunks of at most 100 ids (the server limit). Empty input is a no-op.
    ///
    /// # Errors
    /// The failure kind of the first chunk that failed.
    pub async fn mark_read(&self, ids: &[String]) -> Result<(), ErrorKind> {
        for chunk in ids.chunks(MAX_MARK_IDS) {
            let key = (self.new_key)();
            self.repository.mark_read(chunk, &key).await?;
        }
        Ok(())
    }

    /// Marks everything read; returns how many changed.
    ///
    /// # Errors
    /// The failure kind.
    pub async fn mark_all_read(&self) -> Result<u32, ErrorKind> {
        let key = (self.new_key)();
        self.repository.mark_all_read(&key).await
    }

    /// The delivery switches.
    ///
    /// # Errors
    /// The failure kind.
    pub async fn preferences(&self) -> Result<Preferences, ErrorKind> {
        self.repository.get_preferences().await
    }

    /// Stores the delivery switches; returns what the server kept.
    ///
    /// # Errors
    /// The failure kind.
    pub async fn update_preferences(
        &self,
        preferences: &Preferences,
    ) -> Result<Preferences, ErrorKind> {
        let key = (self.new_key)();
        self.repository.update_preferences(preferences, &key).await
    }

    /// Opens the in-app link of a notification; false when it is empty or no route accepts it.
    #[must_use]
    pub fn open_link(&self, link: &str) -> bool {
        !link.is_empty() && self.navigator.open(link)
    }
}
