//! Search: a read-only, cross-module search with suggestions (domain, data, presentation, Slint
//! view, five locales). Nothing is written and nothing is queued offline.
//!
//! Layers: `domain` is pure and depends on nothing but `aedst-common`; `data` and `presentation`
//! depend on `domain`; the Slint view is rendered by `ui_glue`. Features depend on core crates only,
//! never on another feature.

pub mod data;
pub mod domain;
pub mod presentation;
/// The Slint view of this crate (feature `standalone`; the shell includes `ui_glue_body.rs` itself).
#[cfg(feature = "standalone")]
pub mod ui_glue;
