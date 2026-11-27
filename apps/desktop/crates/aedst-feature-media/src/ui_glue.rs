//! Binds the Slint screens to the controllers. This is the only Slint-aware Rust in the feature.
//!
//! The view models publish plain data; this file copies it into the `MediaStore` global on the UI
//! thread (decoded pixels become a `slint::Image` there) and turns the screens' callbacks into
//! controller calls on the runtime.
//!
//! The binding code itself is in `ui_glue_body.rs`, which the shell includes as well (see there).

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
    MediaDemoWindow, MediaPhase, MediaRowData, MediaStore, MediaTexts, MediaUploadCleanup,
    MediaUploadStage, MediaUploadState, MediaViewerPhase,
};

// This crate, under the name the shared binding code uses for it.
use crate as feature;

include!("ui_glue_body.rs");
