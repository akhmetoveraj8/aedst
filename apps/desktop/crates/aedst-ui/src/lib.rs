//! AEDST Slint design system: the 60 components of the kit manifest (`ui-kit.yaml`) plus `AedstActionRow`.
//!
//! The components live in `ui/*.slint`; features import them with a library path that points
//! at [`UI_DIR`]. [`gallery`] shows every component in LTR/RTL and light/dark. Component list: `README.md`.

/// Directory that holds the `.slint` sources of the design system (for other crates' build scripts).
pub const UI_DIR: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/ui");

/// Slint-generated code (the gallery window). Hand-written code stays outside this module.
#[allow(
    missing_docs,
    clippy::all,
    clippy::pedantic,
    clippy::unwrap_used,
    clippy::expect_used
)]
pub mod gallery {
    slint::include_modules!();
}
