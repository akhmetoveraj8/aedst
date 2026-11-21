---
title: "Gateway (Rust) stack"
description: "Approved crates of apps/gateway, the Rust realtime WebSocket gateway fed by NATS JetStream (ADR-0021)."
---

# Realtime gateway (Rust) stack

`apps/gateway` (crate `aedst-gateway`) is the one Rust service next to the Go server. Decision and rationale: [ADR-0021](../../../apps/server/docs/adr/0021-nats-jetstream-and-rust-gateway.md). Versions were checked against crates.io on 2026-11-18; on 2026-11-21 every version and every feature name in `Cargo.toml` was checked against the crates.io API and exists. **None of them has been compiled together yet** (no Rust toolchain on the authoring machine): whether the chosen features are sufficient for the code is UNVERIFIED. A crate is approved only when it is in `Cargo.toml`, in `apps/gateway/approved-crates.txt` and in this table; `apps/desktop/scripts/check-approved-crates.sh` enforces that without cargo and fails when a version shared with `apps/desktop` drifts.

| Responsibility | Tool | Notes |
|---|---|---|
| Toolchain | Rust 1.100.0, edition 2024 (`rust-toolchain.toml`) | Owner decision; 1.100.0 UNVERIFIED locally |
| Async runtime | `tokio` 1.54.1, `tokio-util` 0.7.20, `futures` 0.3.34 | |
| WebSocket and HTTP | `axum` 0.8.9 (`ws`, `http1`, `tokio`) + `hyper-util` 0.1.21 (`tokio`, `server`, `http1`, `service`) | Compared with tokio-tungstenite 0.30.0 (axum's `ws` builds on 0.29; not a dependency: it was declared and unused, removed 2026-11-21) and `fastwebsockets` 0.10.0 (6.6M downloads, one release in 2026). axum gives the upgrade and `/livez` `/readyz` with no hand-written protocol. `axum::serve` has no configuration, so the accept loop (`src/server.rs`) serves connections through `hyper-util`, the crate axum itself uses, to set a header-read timeout and a cap on connections in the HTTP phase |
| Broker client | `async-nats` 0.53.0 (JetStream pull consumer, explicit ack) | Ephemeral consumer per replica, `DeliverPolicy::New` |
| Token verification | `jsonwebtoken` 12.0.0 (`rust_crypto` backend, `default-features = false`) + `reqwest` 0.13.5 (`rustls`) for JWKS | `openidconnect` 4.1.0 is a client library, not a resource-server verifier. The JWKS cache (about 60 lines) is project-specific: no crate does cached discovery + kid refresh for access tokens |
| Owner id | `sha2` 0.11.1, `uuid` 1.29.0 | Mirrors Go `ids.FromExternal`; vectors shared with the Go tests |
| Serialisation | `serde` 1.0.229, `serde_json` 1.0.154 | |
| Errors | `thiserror` 2.0.21 | No `anyhow` in library code |
| Observability | `tracing` 0.1.44, `tracing-subscriber` 0.3.23, `opentelemetry` / `opentelemetry_sdk` / `opentelemetry-otlp` 0.33.1, `tracing-opentelemetry` 0.34.0 | OTLP/HTTP traces and two consumer metrics, `aedst_gateway_consumer_attached` and `aedst_gateway_consumer_reconnects_total` (`trace`, `http-proto`, `reqwest-client`; `rt-tokio` on the SDK). The names exist; whether the async `reqwest-client` works with the thread-based batch processor of the SDK is UNVERIFIED (fallback: `reqwest-blocking-client`). No connection metrics yet |
| Tests | built-in `#[test]`, `ed25519-dalek` 3.0.0 (`alloc`, `pkcs8`; test keys generated at run time), `base64` 0.23.1 (test-only, the JWK key value; replaces a hand-written encoder) | End-to-end test is in Go: `apps/server/internal/platform/natsbridge/gateway_e2e_integration_test.go` |
| Lint and supply chain | `rustfmt`, `clippy -D warnings` (`unwrap_used`, `expect_used`, `panic`, `print_*` denied), `unsafe_code = "forbid"`, `cargo-deny` 0.20.2 (`deny.toml`) | |

## Explicit rejections (do not re-propose)

`coder/websocket` or any Go WebSocket server (owner decision), a hand-written WebSocket or JWT implementation, `openssl` / `native-tls` (rustls only), `unwrap()`, `expect()` and `unsafe` in production code, committed generated code, a second broker client, `redis`-based fan-out (JetStream is the transport), Kafka.
