//! Offline write queue (ADR-0034 of the Qt app, ported).
//!
//! The table lives in the shared database (`aedst-persistence`, migration 1). Handlers are
//! contributed per feature; the service triggers the drainer and applies the backoff.

pub mod drainer;
pub mod queue;
pub mod service;

pub use drainer::{Delivery, Handlers, MAX_ATTEMPTS, OutboxHandler, RunResult, run};
pub use queue::{OutboxItem, SqliteOutbox, Status};
pub use service::{OutboxService, retry_delay};
