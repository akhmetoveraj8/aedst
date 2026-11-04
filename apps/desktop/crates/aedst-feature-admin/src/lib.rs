//! Admin: the operator screen (overview, tasks, audit log, broadcast).
//!
//! Layers: `domain` is pure and depends on nothing but `aedst-common`; `data` and `presentation`
//! depend on `domain`; the Slint view is rendered by `ui_glue`. Nothing is queued offline, and the
//! server enforces the `admin` role regardless of the client-side gate.

pub mod data;
pub mod domain;
pub mod presentation;
pub mod ui_glue;
