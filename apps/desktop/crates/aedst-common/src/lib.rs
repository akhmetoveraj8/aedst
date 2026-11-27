//! Shared, UI-free primitives for the AEDST desktop app.

pub mod error_kind;
pub mod paging;

pub use error_kind::{ErrorKind, OutboxVerdict, Transport};
pub use paging::PageCursor;
