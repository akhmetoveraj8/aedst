//! Messages and Connect clients generated at build time from `apps/server/api/proto`.
//!
//! Nothing generated is committed. A new RPC needs no hand-written entry: it appears here
//! when the server proto changes and this crate is rebuilt.

/// Slint-style note: generated code is not under our lints (it is third-party output).
#[allow(
    missing_docs,
    clippy::all,
    clippy::pedantic,
    clippy::unwrap_used,
    clippy::expect_used
)]
pub mod proto {
    connectrpc::include_generated!();
}
