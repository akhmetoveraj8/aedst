//! Consent: crash reports and analytics are separate opt-ins, both OFF until the user says yes.
//!
//! The choice is persisted through a [`ConsentStore`] (the shell backs it with
//! `aedst_persistence::KvStore` via [`KvConsentStore`]) and published on a `watch` channel, so a
//! change applies at once: the crash reporter and the analytics transport read the channel on every
//! event and never cache it.

use std::collections::HashMap;
use std::sync::Mutex;

use aedst_persistence::{KvStore, PersistenceError};
use futures::future::BoxFuture;
use tokio::sync::watch;

const CRASH_KEY: &str = "telemetry.consent.crash";
const ANALYTICS_KEY: &str = "telemetry.consent.analytics";

/// A failure to read or write the consent store.
#[derive(Debug, thiserror::Error)]
#[error("consent store failed: {0}")]
pub struct ConsentError(pub String);

impl From<PersistenceError> for ConsentError {
    fn from(error: PersistenceError) -> Self {
        Self(error.to_string())
    }
}

/// A tiny byte store for the consent flags and the anonymous install id.
pub trait ConsentStore: Send + Sync {
    /// Reads a value; `None` when absent.
    fn get<'a>(&'a self, key: &'a str) -> BoxFuture<'a, Result<Option<Vec<u8>>, ConsentError>>;
    /// Writes a value.
    fn set<'a>(&'a self, key: &'a str, value: &'a [u8]) -> BoxFuture<'a, Result<(), ConsentError>>;
    /// Removes a value (no error when absent).
    fn delete<'a>(&'a self, key: &'a str) -> BoxFuture<'a, Result<(), ConsentError>>;
}

/// [`ConsentStore`] kept in memory (tests, and a fallback when the database cannot be opened:
/// consent then lasts for the session only, which errs on the side of asking again).
#[derive(Default)]
pub struct MemoryConsentStore {
    values: Mutex<HashMap<String, Vec<u8>>>,
}

impl MemoryConsentStore {
    fn lock(&self) -> std::sync::MutexGuard<'_, HashMap<String, Vec<u8>>> {
        self.values
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
    }
}

impl ConsentStore for MemoryConsentStore {
    fn get<'a>(&'a self, key: &'a str) -> BoxFuture<'a, Result<Option<Vec<u8>>, ConsentError>> {
        Box::pin(async move { Ok(self.lock().get(key).cloned()) })
    }

    fn set<'a>(&'a self, key: &'a str, value: &'a [u8]) -> BoxFuture<'a, Result<(), ConsentError>> {
        Box::pin(async move {
            self.lock().insert(key.to_owned(), value.to_vec());
            Ok(())
        })
    }

    fn delete<'a>(&'a self, key: &'a str) -> BoxFuture<'a, Result<(), ConsentError>> {
        Box::pin(async move {
            self.lock().remove(key);
            Ok(())
        })
    }
}

/// [`ConsentStore`] on the app's `kv` table.
#[derive(Clone)]
pub struct KvConsentStore {
    kv: KvStore,
}

impl KvConsentStore {
    /// Wraps the shell's `KvStore`.
    #[must_use]
    pub fn new(kv: KvStore) -> Self {
        Self { kv }
    }
}

impl ConsentStore for KvConsentStore {
    fn get<'a>(&'a self, key: &'a str) -> BoxFuture<'a, Result<Option<Vec<u8>>, ConsentError>> {
        Box::pin(async move { Ok(self.kv.get(key).await?) })
    }

    fn set<'a>(&'a self, key: &'a str, value: &'a [u8]) -> BoxFuture<'a, Result<(), ConsentError>> {
        Box::pin(async move { Ok(self.kv.set(key, value).await?) })
    }

    fn delete<'a>(&'a self, key: &'a str) -> BoxFuture<'a, Result<(), ConsentError>> {
        Box::pin(async move { Ok(self.kv.delete(key).await?) })
    }
}

/// What the user allowed. The default is "nothing".
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct ConsentState {
    /// Crash and error reports (Sentry).
    pub crash: bool,
    /// Product analytics (the project's own server).
    pub analytics: bool,
}

/// The persisted, observable consent. Cheap to share behind an `Arc`.
pub struct Consent {
    store: Box<dyn ConsentStore>,
    state: watch::Sender<ConsentState>,
}

impl Consent {
    /// Reads the stored choice. A missing, unreadable or malformed value counts as "no".
    pub async fn load(store: Box<dyn ConsentStore>) -> Self {
        let state = ConsentState {
            crash: read_flag(store.as_ref(), CRASH_KEY).await,
            analytics: read_flag(store.as_ref(), ANALYTICS_KEY).await,
        };
        Self {
            store,
            state: watch::channel(state).0,
        }
    }

    /// The current choice.
    #[must_use]
    pub fn state(&self) -> ConsentState {
        *self.state.borrow()
    }

    /// A receiver that always sees the latest choice and wakes on changes.
    #[must_use]
    pub fn subscribe(&self) -> watch::Receiver<ConsentState> {
        self.state.subscribe()
    }

    /// The store, shared with the install id.
    #[must_use]
    pub fn store(&self) -> &dyn ConsentStore {
        self.store.as_ref()
    }

    /// Turns crash reports on or off, effective at once.
    ///
    /// # Errors
    /// The store failed. Withdrawing still takes effect in memory; granting does not.
    pub async fn set_crash(&self, on: bool) -> Result<(), ConsentError> {
        self.set(CRASH_KEY, on, |state| state.crash = on).await
    }

    /// Turns analytics on or off, effective at once.
    ///
    /// # Errors
    /// The store failed. Withdrawing still takes effect in memory; granting does not.
    pub async fn set_analytics(&self, on: bool) -> Result<(), ConsentError> {
        self.set(ANALYTICS_KEY, on, |state| state.analytics = on)
            .await
    }

    async fn set(
        &self,
        key: &str,
        on: bool,
        apply: impl FnOnce(&mut ConsentState),
    ) -> Result<(), ConsentError> {
        let stored = self.store.set(key, if on { b"1" } else { b"0" }).await;
        if stored.is_ok() || !on {
            self.state.send_modify(apply);
        }
        stored
    }
}

async fn read_flag(store: &dyn ConsentStore, key: &str) -> bool {
    matches!(store.get(key).await, Ok(Some(value)) if value == b"1")
}
