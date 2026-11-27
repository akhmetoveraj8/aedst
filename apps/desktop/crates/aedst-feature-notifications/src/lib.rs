//! Notifications: inbox, unread badge with polling backoff, and preferences (domain, data,
//! presentation, Slint views, five locales).
//!
//! Layers: `domain` is pure and depends on nothing but `aedst-common`; `data` and `presentation`
//! depend on `domain`; the Slint views are rendered by `ui_glue`. Features depend on core crates
//! only, never on another feature. Desktop has no push channel: the app polls the unread count.

pub mod data;
pub mod domain;
pub mod presentation;
/// The Slint view of this crate (feature `standalone`; the shell includes `ui_glue_body.rs` itself).
#[cfg(feature = "standalone")]
pub mod ui_glue;
