//! Media: the library, upload to a presigned URL and the image viewer (domain, data, presentation,
//! Slint view, five locales).
//!
//! Layers: `domain` is pure and depends on nothing but `aedst-common`; `data` and `presentation`
//! depend on `domain`; the Slint view is rendered by `ui_glue`. Features depend on core crates only,
//! never on another feature. Presigned URLs carry credentials: they are wrapped in
//! [`domain::SecretUrl`] and never logged or put into an error.

pub mod data;
pub mod domain;
pub mod presentation;
/// The Slint view of this crate (feature `standalone`; the shell includes `ui_glue_body.rs` itself).
#[cfg(feature = "standalone")]
pub mod ui_glue;
