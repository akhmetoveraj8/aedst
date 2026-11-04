//! Binds the Slint screen to the search controller. This is the only Slint-aware Rust in the feature.
//!
//! The view model publishes plain data ([`SearchView`]); this file copies it into the `SearchStore`
//! global on the UI thread and turns the screen's callbacks into controller calls on the runtime.

use std::sync::Arc;

use slint::{ComponentHandle, ModelRc, SharedString, VecModel};
use tokio::runtime::Handle;

use crate::presentation::{HitRow, Phase, SearchController, SearchView};

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

pub use generated::{HitRowData, SearchDemoWindow, SearchStore, SearchTexts};

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

fn row_data(row: &HitRow) -> HitRowData {
    HitRowData {
        kind: row.kind.key().into(),
        title: row.title.as_str().into(),
        snippet: row.snippet.as_str().into(),
        openable: row.openable,
    }
}

/// Copies a published view into the store. Pure data in, UI properties out.
pub fn apply(store: &SearchStore<'_>, view: &SearchView) {
    let rows: Vec<HitRowData> = view.hits.iter().map(row_data).collect();
    store.set_rows(ModelRc::new(VecModel::from(rows)));
    let suggestions: Vec<SharedString> =
        view.suggestions.iter().map(|s| s.as_str().into()).collect();
    store.set_suggestions(ModelRc::new(VecModel::from(suggestions)));
    store.set_total(
        view.total_estimate
            .and_then(|n| i32::try_from(n).ok())
            .unwrap_or(-1),
    );
    store.set_has_more(view.has_more);
    store.set_loading_more(view.loading_more);

    let (phase, load_error) = match view.phase {
        Phase::Idle => ("idle", None),
        Phase::Loading => ("loading", None),
        Phase::Ready => ("ready", None),
        Phase::Failed(kind) => ("failed", Some(kind)),
    };
    store.set_phase(phase.into());
    let shown = load_error.or(view.action_error);
    store.set_error_kind(shown.map_or(SharedString::new(), |k| k.name().into()));
}

/// Connects the screen of `ui` to `controller`. Callbacks run on the UI thread and hand the work to
/// `runtime`; every published view is applied on the UI thread.
pub fn bind<C>(ui: &C, controller: &Arc<SearchController>, runtime: &Handle)
where
    C: ComponentHandle + 'static,
    for<'a> SearchStore<'a>: slint::Global<'a, C>,
{
    let store = ui.global::<SearchStore>();

    store.on_query_edited({
        let (controller, runtime) = (Arc::clone(controller), runtime.clone());
        move |text| {
            let (controller, text) = (Arc::clone(&controller), text.to_string());
            runtime.spawn(async move { controller.set_query(&text) });
        }
    });
    store.on_submit({
        let (controller, runtime) = (Arc::clone(controller), runtime.clone());
        move || {
            let controller = Arc::clone(&controller);
            runtime.spawn(async move { controller.submit().await });
        }
    });
    store.on_pick_suggestion({
        let (controller, runtime) = (Arc::clone(controller), runtime.clone());
        move |suggestion| {
            let (controller, suggestion) = (Arc::clone(&controller), suggestion.to_string());
            runtime.spawn(async move { controller.pick_suggestion(&suggestion).await });
        }
    });
    store.on_load_more({
        let (controller, runtime) = (Arc::clone(controller), runtime.clone());
        move || {
            let controller = Arc::clone(&controller);
            runtime.spawn(async move { controller.load_more().await });
        }
    });
    store.on_open_hit({
        let controller = Arc::clone(controller);
        move |index| {
            if let Ok(index) = usize::try_from(index) {
                controller.open_hit(index);
            }
        }
    });

    let weak = ui.as_weak();
    let mut updates = controller.subscribe();
    runtime.spawn(async move {
        loop {
            let view = updates.borrow_and_update().clone();
            let shown =
                weak.upgrade_in_event_loop(move |ui| apply(&ui.global::<SearchStore>(), &view));
            if shown.is_err() || updates.changed().await.is_err() {
                break; // the window is gone, or the controller was dropped
            }
        }
    });
}
