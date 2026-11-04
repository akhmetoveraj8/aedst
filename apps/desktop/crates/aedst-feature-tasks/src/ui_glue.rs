//! Binds the Slint screen to the list controller. This is the only Slint-aware Rust in the feature.
//!
//! The view model publishes plain data ([`ListView`]); this file copies it into the `TasksStore`
//! global on the UI thread and turns the screen's callbacks into controller calls on the runtime.

use std::sync::Arc;

use slint::{ComponentHandle, ModelRc, SharedString, VecModel};
use tokio::runtime::Handle;

use crate::presentation::{CreateStatus, ListView, Phase, Row, TaskListController};

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

pub use generated::{TaskRowData, TaskTexts, TasksDemoWindow, TasksStore};

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

fn row_data(row: &Row) -> TaskRowData {
    TaskRowData {
        id: row.id.as_str().into(),
        title: row.title.as_str().into(),
        status: row.status.key().into(),
        priority: row.priority.key().into(),
        done: row.done(),
        pending: row.pending,
    }
}

/// Copies a published view into the store. Pure data in, UI properties out.
pub fn apply(store: &TasksStore<'_>, view: &ListView) {
    let rows: Vec<TaskRowData> = view.rows.iter().map(row_data).collect();
    store.set_rows(ModelRc::new(VecModel::from(rows)));
    store.set_total(
        view.total_count
            .and_then(|n| i32::try_from(n).ok())
            .unwrap_or(-1),
    );
    store.set_has_more(view.has_more);
    store.set_pending_count(i32::try_from(view.pending_count).unwrap_or(i32::MAX));

    let (phase, load_error) = match view.phase {
        Phase::Idle => ("idle", String::new()),
        Phase::Loading => ("loading", String::new()),
        Phase::Ready => ("ready", String::new()),
        Phase::Failed(kind) => ("failed", kind.name().to_owned()),
    };
    store.set_phase(phase.into());
    let action = view
        .action_error
        .map(|k| k.name().to_owned())
        .unwrap_or_default();
    store.set_error_kind(SharedString::from(if load_error.is_empty() {
        action
    } else {
        load_error
    }));

    let (state, error) = match view.create {
        CreateStatus::Idle => ("idle", String::new()),
        CreateStatus::Sending => ("sending", String::new()),
        CreateStatus::Invalid(e) => ("invalid", e.key().to_owned()),
        CreateStatus::Failed(kind) => ("failed", kind.name().to_owned()),
    };
    store.set_create_state(state.into());
    store.set_create_error(error.into());
}

/// Connects the screen of `ui` to `controller`. Callbacks run on the UI thread and hand the work to
/// `runtime`; every published view is applied on the UI thread.
pub fn bind<C>(ui: &C, controller: &Arc<TaskListController>, runtime: &Handle)
where
    C: ComponentHandle + 'static,
    for<'a> TasksStore<'a>: slint::Global<'a, C>,
{
    let store = ui.global::<TasksStore>();

    store.on_reload({
        let (controller, runtime) = (Arc::clone(controller), runtime.clone());
        move || {
            let controller = Arc::clone(&controller);
            runtime.spawn(async move { controller.load_first().await });
        }
    });
    store.on_load_more({
        let (controller, runtime) = (Arc::clone(controller), runtime.clone());
        move || {
            let controller = Arc::clone(&controller);
            runtime.spawn(async move { controller.load_more().await });
        }
    });
    store.on_create({
        let (controller, runtime) = (Arc::clone(controller), runtime.clone());
        move |title, priority| {
            let (controller, title, priority) = (
                Arc::clone(&controller),
                title.to_string(),
                priority.to_string(),
            );
            runtime.spawn(async move { controller.create(&title, "", &priority).await });
        }
    });
    store.on_toggle({
        let (controller, runtime) = (Arc::clone(controller), runtime.clone());
        move |id| {
            let (controller, id) = (Arc::clone(&controller), id.to_string());
            runtime.spawn(async move { controller.toggle(&id).await });
        }
    });

    let weak = ui.as_weak();
    let mut updates = controller.subscribe();
    runtime.spawn(async move {
        loop {
            let view = updates.borrow_and_update().clone();
            let shown =
                weak.upgrade_in_event_loop(move |ui| apply(&ui.global::<TasksStore>(), &view));
            if shown.is_err() || updates.changed().await.is_err() {
                break; // the window is gone, or the controller was dropped
            }
        }
    });
}
