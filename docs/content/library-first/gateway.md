---
title: "Gateway (Rust) stack"
description: "Approved crates of apps/gateway, the Rust realtime WebSocket gateway fed by NATS JetStream (ADR-0020)."
---

# Realtime gateway (Rust) stack

`apps/gateway` (crate `aedst-gateway`) is the one Rust service next to the Go server. Decision and rationale: [ADR-0020](../../../apps/server/docs/adr/0020-nats-jetstream-and-rust-gateway.md). Versions were checked against crates.io on 2026-11-18; **none of them has been compiled together yet** (no Rust toolchain on the authoring machine), features marked UNVERIFIED are guesses from the crates' documentation.

| Responsibility | Tool | Notes |
|---|---|---|
| Toolchain | Rust 1.100.0, edition 2024 (`rust-toolchain.toml`) | Owner decision; 1.100.0 UNVERIFIED locally |
| Async runtime | `tokio` 1.54.1, `tokio-util` 0.7.20, `futures` 0.3.34 | |
| WebSocket and HTTP | `axum` 0.8.9 (`ws`, `http1`, `tokio`) | Compared with `tokio-tungstenite` 0.30.0 (what axum's `ws` builds on; kept as the test client) and `fastwebsockets` 0.10.0 (6.6M downloads, one release in 2026). axum gives upgrade, `/livez` `/readyz` and graceful shutdown with no hand-written protocol |
| Broker client | `async-nats` 0.53.0 (JetStream pull consumer, explicit ack) | Ephemeral consumer per replica, `DeliverPolicy::New` |
| Token verification | `jsonwebtoken` 12.0.0 (`rust_crypto` feature UNVERIFIED) + `reqwest` 0.13.5 (`rustls`) for JWKS | `openidconnect` 4.1.0 is a client library, not a resource-server verifier. The JWKS cache (about 60 lines) is project-specific: no crate does cached discovery + kid refresh for access tokens |
| Owner id | `sha2` 0.11.1, `uuid` 1.29.0 | Mirrors Go `ids.FromExternal`; vectors shared with the Go tests |
| Serialisation | `serde` 1.0.229, `serde_json` 1.0.154 | |
| Errors | `thiserror` 2.0.21 | No `anyhow` in library code |
| Observability | `tracing` 0.1.44, `tracing-subscriber` 0.3.23, `opentelemetry` / `opentelemetry_sdk` / `opentelemetry-otlp` 0.33.1, `tracing-opentelemetry` 0.34.0 | OTLP/HTTP traces only; feature names UNVERIFIED. No metrics yet |
| Tests | built-in `#[test]`, `ed25519-dalek` 3.0.0 (test keys generated at run time), `tokio-tungstenite` 0.30.0 | End-to-end test is in Go: `apps/server/internal/platform/natsbridge/gateway_e2e_integration_test.go` |
| Lint and supply chain | `rustfmt`, `clippy -D warnings` (`unwrap_used`, `expect_used`, `panic`, `print_*` denied), `unsafe_code = "forbid"`, `cargo-deny` 0.20.2 (`deny.toml`) | |

## Explicit rejections (do not re-propose)

`coder/websocket` or any Go WebSocket server (owner decision), a hand-written WebSocket or JWT implementation, `openssl` / `native-tls` (rustls only), `unwrap()`, `expect()` and `unsafe` in production code, committed generated code, a second broker client, `redis`-based fan-out (JetStream is the transport), Kafka.
