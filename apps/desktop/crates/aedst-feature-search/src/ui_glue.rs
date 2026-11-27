//! Binds the Slint screen to the search controller. This is the only Slint-aware Rust in the feature.
//!
//! The view model publishes plain data ([`SearchView`]); this file copies it into the `SearchStore`
//! global on the UI thread and turns the screen's callbacks into controller calls on the runtime.
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

pub use generated::{HitRowData, SearchDemoWindow, SearchPhase, SearchStore, SearchTexts};

// This crate, under the name the shared binding code uses for it.
use crate as feature;

include!("ui_glue_body.rs");
