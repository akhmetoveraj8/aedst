//! Binds the Slint views to the controllers. This is the only Slint-aware Rust in the feature.
//!
//! The view models publish plain data ([`InboxView`], [`PreferencesView`], the unread count); this
//! file copies it into the `NotificationsStore` global on the UI thread and turns the views'
//! callbacks into controller calls on the runtime.

use std::sync::Arc;

use slint::{ComponentHandle, ModelRc, SharedString, VecModel};
use tokio::runtime::Handle;

use crate::presentation::{
    InboxController, InboxView, Phase, PreferencesController, PreferencesView, PrefsPhase, Row,
    UnreadCounter,
};

/// Slint-generated code. It uses `unwrap()` and undocumented items, so the workspace lints are
/// relaxed for this module only; hand-written code stays outside it.
#[allow(
    missing_docs,
    clippy::all,
    clippy::pedantic,
    clippy::unwrap_used,
    clippy::expect_used
)]
mod generated {
    slint::include_modules!();
}

pub use generated::{
    NotificationRowData, NotificationsDemoWindow, NotificationsStore, NotificationsTexts,
};

/// Arabic is the only right-to-left locale; the shell sets `AedstLayout.rtl` from this.
#[must_use]
pub fn language_is_rtl(language: &str) -> bool {
    language == "ar"
}

/// Switches the bundled translation (`en`, `ru`, `tg`, `uz`, `ar`). Unknown codes fall back to English.
///
/// # Errors
/// The Slint error when the language is not bundled.
pub fn select_language(language: &str) -> Result<(), slint::SelectBundledTranslationError> {
    slint::select_bundled_translation(language)
}

fn row_data(row: &Row) -> NotificationRowData {
    NotificationRowData {
        id: row.id.as_str().into(),
        kind: row.kind.key().into(),
        title: row.title.as_str().into(),
        body: row.body.as_str().into(),
        created: row.created.as_str().into(),
        read: row.read,
    }
}

/// Copies a published inbox view into the store. Pure data in, UI properties out.
pub fn apply_inbox(store: &NotificationsStore<'_>, view: &InboxView) {
    let rows: Vec<NotificationRowData> = view.rows.iter().map(row_data).collect();
    store.set_rows(ModelRc::new(VecModel::from(rows)));
    store.set_has_more(view.has_more);
    store.set_unread_only(view.unread_only);
    store.set_marking_all(view.marking_all);
    let (phase, load_error) = match view.phase {
        Phase::Idle => ("idle", None),
        Phase::Loading => ("loading", None),
        Phase::Ready => ("ready", None),
        Phase::Failed(kind) => ("failed", Some(kind)),
    };
    store.set_phase(phase.into());
    let shown = load_error.or(view.action_error);
    store.set_error_kind(SharedString::from(shown.map_or("", |k| k.name())));
}

/// Copies the unread count into the store.
pub fn apply_unread(store: &NotificationsStore<'_>, count: u32) {
    store.set_unread_count(i32::try_from(count).unwrap_or(i32::MAX));
}

/// Copies the preferences view into the store.
pub fn apply_preferences(store: &NotificationsStore<'_>, view: &PreferencesView) {
    let (phase, load_error) = match view.phase {
        PrefsPhase::Idle => ("idle", None),
        PrefsPhase::Loading => ("loading", None),
        PrefsPhase::Ready => ("ready", None),
        PrefsPhase::Failed(kind) => ("failed", Some(kind)),
    };
    store.set_prefs_phase(phase.into());
    let shown = load_error.or(view.save_error);
    store.set_prefs_error_kind(SharedString::from(shown.map_or("", |k| k.name())));
    store.set_push_enabled(view.preferences.push_enabled);
    store.set_task_completed(view.preferences.task_completed);
    store.set_task_due_soon(view.preferences.task_due_soon);
    store.set_media_ready(view.preferences.media_ready);
}

/// Everything the views drive.
pub struct Controllers {
    /// The inbox list.
    pub inbox: Arc<InboxController>,
    /// The four switches.
    pub preferences: Arc<PreferencesController>,
    /// The badge counter.
    pub unread: Arc<UnreadCounter>,
}

/// Forwards every change of `receiver` to the UI thread until the window or the sender is gone.
fn forward<C, T>(
    ui: &C,
    runtime: &Handle,
    mut receiver: tokio::sync::watch::Receiver<T>,
    apply: impl Fn(&NotificationsStore<'_>, &T) + Send + Copy + 'static,
) where
    C: ComponentHandle + 'static,
    for<'a> NotificationsStore<'a>: slint::Global<'a, C>,
    T: Clone + Send + Sync + 'static,
{
    let weak = ui.as_weak();
    runtime.spawn(async move {
        loop {
            let value = receiver.borrow_and_update().clone();
            let shown = weak
                .upgrade_in_event_loop(move |ui| apply(&ui.global::<NotificationsStore>(), &value));
            if shown.is_err() || receiver.changed().await.is_err() {
                break; // the window is gone, or the sender was dropped
            }
        }
    });
}

/// Connects the views of `ui` to the controllers. Callbacks run on the UI thread and hand the work
/// to `runtime`; every published value is applied on the UI thread.
pub fn bind<C>(ui: &C, controllers: &Controllers, runtime: &Handle)
where
    C: ComponentHandle + 'static,
    for<'a> NotificationsStore<'a>: slint::Global<'a, C>,
{
    let store = ui.global::<NotificationsStore>();

    store.on_reload({
        let (inbox, runtime) = (Arc::clone(&controllers.inbox), runtime.clone());
        move || {
            let inbox = Arc::clone(&inbox);
            runtime.spawn(async move { inbox.load_first().await });
        }
    });
    store.on_load_more({
        let (inbox, runtime) = (Arc::clone(&controllers.inbox), runtime.clone());
        move || {
            let inbox = Arc::clone(&inbox);
            runtime.spawn(async move { inbox.load_more().await });
        }
    });
    store.on_open({
        let (inbox, runtime) = (Arc::clone(&controllers.inbox), runtime.clone());
        move |id| {
            let (inbox, id) = (Arc::clone(&inbox), id.to_string());
            runtime.spawn(async move { inbox.open(&id).await });
        }
    });
    store.on_mark_all_read({
        let (inbox, runtime) = (Arc::clone(&controllers.inbox), runtime.clone());
        move || {
            let inbox = Arc::clone(&inbox);
            runtime.spawn(async move { inbox.mark_all_read().await });
        }
    });
    store.on_set_unread_only({
        let (inbox, runtime) = (Arc::clone(&controllers.inbox), runtime.clone());
        move |unread_only| {
            let inbox = Arc::clone(&inbox);
            runtime.spawn(async move { inbox.set_unread_only(unread_only).await });
        }
    });
    store.on_reload_preferences({
        let (prefs, runtime) = (Arc::clone(&controllers.preferences), runtime.clone());
        move || {
            let prefs = Arc::clone(&prefs);
            runtime.spawn(async move { prefs.load().await });
        }
    });
    store.on_set_preference({
        let (prefs, runtime) = (Arc::clone(&controllers.preferences), runtime.clone());
        move |key, value| {
            let (prefs, key) = (Arc::clone(&prefs), key.to_string());
            runtime.spawn(async move { prefs.set(&key, value).await });
        }
    });

    forward(ui, runtime, controllers.inbox.subscribe(), apply_inbox);
    forward(ui, runtime, controllers.unread.subscribe(), |s, c| {
        apply_unread(s, *c);
    });
    forward(
        ui,
        runtime,
        controllers.preferences.subscribe(),
        apply_preferences,
    );
}
