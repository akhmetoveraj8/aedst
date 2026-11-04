//! Binds the Slint screens to the controllers. This is the only Slint-aware Rust in the feature.
//!
//! The view models publish plain data; this file copies it into the `MediaStore` global on the UI
//! thread (decoded pixels become a `slint::Image` there) and turns the screens' callbacks into
//! controller calls on the runtime.

use std::{sync::Arc, time::Duration};

use slint::{ComponentHandle, ModelRc, Rgba8Pixel, SharedPixelBuffer, SharedString, VecModel};
use tokio::runtime::Handle;

use crate::{
    domain::{Cleanup, FailureReason},
    presentation::{
        DecodedImage, LibraryController, LibraryView, Phase, Row, UploadView, ViewerController,
        ViewerPhase, ViewerView,
    },
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

pub use generated::{MediaDemoWindow, MediaRowData, MediaStore, MediaTexts};

/// First poll after a file is seen unfinished; doubles up to [`POLL_MAX`].
const POLL_FIRST: Duration = Duration::from_secs(2);
const POLL_MAX: Duration = Duration::from_secs(30);
/// Polling stops after this many steps without everything finishing (the next reload restarts it).
const POLL_ATTEMPTS: u32 = 20;

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

fn row_data(row: &Row) -> MediaRowData {
    MediaRowData {
        id: row.id.as_str().into(),
        filename: row.filename.as_str().into(),
        kind: row.kind.key().into(),
        status: row.status.key().into(),
        failure: row.failure.map_or("", |f| f.key()).into(),
        size_bytes: i32::try_from(row.size_bytes).unwrap_or(i32::MAX),
        openable: row.openable,
    }
}

/// Copies a published library view into the store. Pure data in, UI properties out.
pub fn apply_library(store: &MediaStore<'_>, view: &LibraryView) {
    let rows: Vec<MediaRowData> = view.rows.iter().map(row_data).collect();
    store.set_rows(ModelRc::new(VecModel::from(rows)));
    store.set_has_more(view.has_more);
    store.set_confirm_delete_id(view.confirm_delete.clone().unwrap_or_default().into());
    store.set_deleting(view.deleting);

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
    apply_upload(store, &view.upload);
}

fn apply_upload(store: &MediaStore<'_>, upload: &UploadView) {
    match upload {
        UploadView::Idle => {
            store.set_upload_state("idle".into());
            store.set_upload_file_name(SharedString::new());
        }
        UploadView::Running {
            file_name, stage, ..
        } => {
            store.set_upload_state("running".into());
            store.set_upload_stage(stage.key().into());
            store.set_upload_file_name(file_name.as_str().into());
            store.set_upload_percent(i32::from(upload.percent()));
        }
        UploadView::Failed {
            file_name,
            stage,
            reason,
            cleanup,
        } => {
            store.set_upload_state("failed".into());
            store.set_upload_stage(stage.key().into());
            store.set_upload_file_name(file_name.as_str().into());
            let (is_validation, key) = match reason {
                FailureReason::Invalid(e) => (true, e.key()),
                FailureReason::Kind(kind) => (false, kind.name()),
            };
            store.set_upload_reason_is_validation(is_validation);
            store.set_upload_reason(key.into());
            store.set_upload_cleanup(
                match cleanup {
                    Cleanup::NotNeeded => "notNeeded",
                    Cleanup::Removed => "removed",
                    Cleanup::Failed => "failed",
                }
                .into(),
            );
        }
    }
}

/// Decoded RGBA pixels as a Slint image. Must run on the UI thread (`slint::Image` is not `Send`).
#[must_use]
pub fn to_slint_image(image: &DecodedImage) -> slint::Image {
    slint::Image::from_rgba8(SharedPixelBuffer::<Rgba8Pixel>::clone_from_slice(
        &image.rgba,
        image.width,
        image.height,
    ))
}

/// Copies a published viewer view into the store.
pub fn apply_viewer(store: &MediaStore<'_>, view: &ViewerView) {
    let (phase, error) = match view.phase {
        ViewerPhase::Closed => ("closed", ""),
        ViewerPhase::Loading => ("loading", ""),
        ViewerPhase::Ready => ("ready", ""),
        ViewerPhase::Failed(kind) => ("failed", kind.name()),
        ViewerPhase::NotReady => ("notReady", ""),
        ViewerPhase::VideoUnavailable => ("videoUnavailable", ""),
        ViewerPhase::NoPreview => ("noPreview", ""),
        ViewerPhase::TooLarge => ("tooLarge", ""),
        ViewerPhase::Undecodable => ("undecodable", ""),
    };
    store.set_viewer_phase(phase.into());
    store.set_viewer_error_kind(error.into());
    store.set_viewer_title(view.title.as_str().into());
    store.set_viewer_image(
        view.image
            .as_deref()
            .map(to_slint_image)
            .unwrap_or_default(),
    );
}

/// Polls while files are unfinished, backing off from 2 s to 30 s, at most [`POLL_ATTEMPTS`] times.
async fn poll_loop(controller: Arc<LibraryController>) {
    let mut updates = controller.subscribe();
    let (mut delay, mut attempts) = (POLL_FIRST, 0_u32);
    loop {
        if !updates.borrow_and_update().unfinished {
            (delay, attempts) = (POLL_FIRST, 0);
            if updates.changed().await.is_err() {
                return; // the controller was dropped
            }
            continue;
        }
        if attempts >= POLL_ATTEMPTS {
            if updates.changed().await.is_err() {
                return;
            }
            // Any new change (a reload, an upload) gives polling a fresh budget.
            attempts = 0;
            continue;
        }
        tokio::time::sleep(delay).await;
        attempts += 1;
        delay = (delay * 2).min(POLL_MAX);
        controller.refresh().await;
    }
}

/// Connects the screens of `ui` to the controllers. Callbacks run on the UI thread and hand the
/// work to `runtime`; every published view is applied on the UI thread.
pub fn bind<C>(
    ui: &C,
    library: &Arc<LibraryController>,
    viewer: &Arc<ViewerController>,
    runtime: &Handle,
) where
    C: ComponentHandle + 'static,
    for<'a> MediaStore<'a>: slint::Global<'a, C>,
{
    let store = ui.global::<MediaStore>();

    store.on_reload({
        let (library, runtime) = (Arc::clone(library), runtime.clone());
        move || {
            let library = Arc::clone(&library);
            runtime.spawn(async move { library.load_first().await });
        }
    });
    store.on_load_more({
        let (library, runtime) = (Arc::clone(library), runtime.clone());
        move || {
            let library = Arc::clone(&library);
            runtime.spawn(async move { library.load_more().await });
        }
    });
    store.on_pick_upload({
        let (library, runtime) = (Arc::clone(library), runtime.clone());
        move || {
            let library = Arc::clone(&library);
            runtime.spawn(async move { library.pick_and_upload().await });
        }
    });
    store.on_dismiss_upload({
        let library = Arc::clone(library);
        move || library.dismiss_upload()
    });
    store.on_request_delete({
        let library = Arc::clone(library);
        move |id| library.request_delete(id.as_str())
    });
    store.on_cancel_delete({
        let library = Arc::clone(library);
        move || library.cancel_delete()
    });
    store.on_confirm_delete({
        let (library, runtime) = (Arc::clone(library), runtime.clone());
        move || {
            let library = Arc::clone(&library);
            runtime.spawn(async move { library.confirm_delete().await });
        }
    });
    store.on_open({
        let (library, viewer, runtime) = (Arc::clone(library), Arc::clone(viewer), runtime.clone());
        move |id| {
            let (library, viewer, id) = (Arc::clone(&library), Arc::clone(&viewer), id.to_string());
            runtime.spawn(async move {
                if let Some(media) = library.media(&id) {
                    viewer.open(&media).await;
                }
            });
        }
    });
    store.on_close_viewer({
        let viewer = Arc::clone(viewer);
        move || viewer.close()
    });

    let weak = ui.as_weak();
    let mut updates = library.subscribe();
    runtime.spawn(async move {
        loop {
            let view = updates.borrow_and_update().clone();
            let shown = weak
                .upgrade_in_event_loop(move |ui| apply_library(&ui.global::<MediaStore>(), &view));
            if shown.is_err() || updates.changed().await.is_err() {
                break; // the window is gone, or the controller was dropped
            }
        }
    });

    let weak = ui.as_weak();
    let mut updates = viewer.subscribe();
    runtime.spawn(async move {
        loop {
            let view = updates.borrow_and_update().clone();
            let shown = weak
                .upgrade_in_event_loop(move |ui| apply_viewer(&ui.global::<MediaStore>(), &view));
            if shown.is_err() || updates.changed().await.is_err() {
                break;
            }
        }
    });

    runtime.spawn(poll_loop(Arc::clone(library)));
}
