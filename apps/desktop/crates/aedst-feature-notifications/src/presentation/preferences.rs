//! The preferences view model: four switches, optimistic update, rollback and the error kind on
//! failure. Writes are not queued offline.

use std::sync::{Arc, Mutex, PoisonError};

use aedst_common::ErrorKind;
use tokio::sync::watch;

use crate::domain::{NotificationsService, PreferenceKey, Preferences};

/// Where loading stands.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum PrefsPhase {
    /// Nothing requested yet.
    Idle,
    /// The switches are loading.
    Loading,
    /// The switches are shown.
    Ready,
    /// Loading failed; show the translated message of this kind and a retry.
    Failed(ErrorKind),
}

/// Everything the preferences view needs.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct PreferencesView {
    /// Loading phase.
    pub phase: PrefsPhase,
    /// The switches as shown (optimistic while a save is in flight).
    pub preferences: Preferences,
    /// The last save failed (the switch is back to its old value); `Cancelled` is never stored.
    pub save_error: Option<ErrorKind>,
}

struct Inner {
    view: PreferencesView,
    /// Saves in flight; the server's answer replaces the shown state only when none remain.
    in_flight: u32,
}

/// Drives the preferences view.
pub struct PreferencesController {
    service: Arc<NotificationsService>,
    inner: Mutex<Inner>,
    published: watch::Sender<PreferencesView>,
}

impl Default for PreferencesView {
    fn default() -> Self {
        Self {
            phase: PrefsPhase::Idle,
            preferences: Preferences::default(),
            save_error: None,
        }
    }
}

impl PreferencesController {
    /// A controller over the use cases.
    #[must_use]
    pub fn new(service: Arc<NotificationsService>) -> Arc<Self> {
        Arc::new(Self {
            service,
            inner: Mutex::new(Inner {
                view: PreferencesView::default(),
                in_flight: 0,
            }),
            published: watch::channel(PreferencesView::default()).0,
        })
    }

    /// The UI subscribes here.
    #[must_use]
    pub fn subscribe(&self) -> watch::Receiver<PreferencesView> {
        self.published.subscribe()
    }

    fn update<T>(&self, work: impl FnOnce(&mut Inner, &mut PreferencesView) -> T) -> T {
        let mut inner = self.inner.lock().unwrap_or_else(PoisonError::into_inner);
        let mut view = inner.view;
        let result = work(&mut inner, &mut view);
        inner.view = view;
        drop(inner);
        self.published.send_replace(view);
        result
    }

    /// Loads the switches from the server.
    pub async fn load(&self) {
        self.update(|_, v| {
            v.phase = PrefsPhase::Loading;
            v.save_error = None;
        });
        let result = self.service.preferences().await;
        self.update(|_, v| match result {
            Ok(preferences) => {
                v.preferences = preferences;
                v.phase = PrefsPhase::Ready;
            }
            Err(ErrorKind::Cancelled) => v.phase = PrefsPhase::Idle,
            Err(kind) => v.phase = PrefsPhase::Failed(kind),
        });
    }

    /// Sets one switch (`key` is the screen's key, e.g. `task-due-soon`). The switch moves at once;
    /// a failed save puts it back and publishes the error kind.
    pub async fn set(&self, key: &str, value: bool) {
        let Some(key) = PreferenceKey::from_key(key) else {
            return;
        };
        let Some((desired, old)) = self.update(|i, v| {
            if v.phase != PrefsPhase::Ready {
                return None;
            }
            let old = v.preferences.get(key);
            v.preferences = v.preferences.with(key, value);
            v.save_error = None;
            i.in_flight += 1;
            Some((v.preferences, old))
        }) else {
            return;
        };
        let result = self.service.update_preferences(&desired).await;
        self.update(|i, v| {
            i.in_flight = i.in_flight.saturating_sub(1);
            match result {
                Ok(stored) if i.in_flight == 0 => v.preferences = stored,
                Ok(_) => {}
                Err(kind) => {
                    v.preferences = v.preferences.with(key, old);
                    if kind != ErrorKind::Cancelled {
                        v.save_error = Some(kind);
                    }
                }
            }
        });
    }
}
