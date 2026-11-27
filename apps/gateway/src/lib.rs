//! AEDST realtime gateway (ADR-0021, ADR-0026): consumes integration events from NATS JetStream and
//! pushes them to authenticated WebSocket clients. Server to client only; the API stays the source of
//! truth, and the Go server decides who a client is.

pub mod auth;
pub mod config;
pub mod consumer;
pub mod envelope;
pub mod hub;
pub mod server;
pub mod telemetry;
pub mod ws;

/// Messages and the `RealtimeService` client generated at build time from `apps/server/api/proto`.
/// Generated code is third-party output and not under our lints.
#[allow(
    missing_docs,
    clippy::all,
    clippy::pedantic,
    clippy::unwrap_used,
    clippy::expect_used,
    clippy::panic,
    clippy::print_stdout,
    clippy::print_stderr
)]
pub mod proto {
    connectrpc::include_generated!();
}
