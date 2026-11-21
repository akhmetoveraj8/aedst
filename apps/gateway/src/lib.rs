//! AEDST realtime gateway (ADR-0021): consumes integration events from NATS JetStream and pushes
//! them to authenticated WebSocket clients. Server to client only; the API stays the source of truth.

pub mod auth;
pub mod config;
pub mod consumer;
pub mod envelope;
pub mod hub;
pub mod server;
pub mod telemetry;
pub mod ws;
