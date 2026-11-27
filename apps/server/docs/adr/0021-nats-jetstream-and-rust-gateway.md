# ADR-0021: NATS JetStream and a Rust WebSocket gateway

Status: Accepted (owner decision, 2026-11-18). Amends [ADR-0014](../../../../docs/content/decisions/0014-river-insert-tx-as-outbox.md) (its "NATS is not adopted now" clause) and replaces the realtime transport proposal of [ADR-0008](../../../../docs/content/decisions/0008-realtime-and-media-extraction.md). Spec: [`specs/realtime/ws-gateway.md`](../../specs/realtime/ws-gateway.md).

> **Amended 2026-11-28 by [ADR-0026](0026-gateway-connection-access-and-protobuf-envelope.md):** the gateway no longer verifies tokens (it calls the Go `RealtimeService.GetConnectionAccess`; the "Auth exception" below is void and the gateway has no `AEDST_OIDC_*`, `jsonwebtoken` or owner-id mirror), and the message body is the Protobuf `aedst.events.v1.EventEnvelope` instead of JSON (the client frame is unchanged). When to write backend code in Rust at all: [ADR-0025](0025-rust-admission-criteria.md).

## Context

The owner decided that CPU-heavy, latency-critical and systems parts may be written in Rust (1.100.0), that WebSocket is served by Rust rather than `coder/websocket`, and that NATS JetStream may carry events to that Rust gateway. ADR-0014 had reserved exactly this seam: "the bridge to a broker is itself a River-delivered consumer; `events.Publisher` is the seam; never a dual write".

## Decision

- **Broker:** NATS JetStream, only for delivering events to services that are not the Go monolith. The Go monolith's own consumers stay on River. No Kafka, RabbitMQ or second broker.
- **Bridge (Go):** `internal/platform/natsbridge` is the only package that imports `github.com/nats-io/`. It registers one River-delivered consumer per allowlisted event type (`AEDST_NATS_FORWARD_TYPES`), named `platform.nats_forward:<type>`, so `river_job` stays the outbox, retries and discard are River's, and producers keep calling `events.Publisher.Publish`. Disabled when `AEDST_NATS_URL` is empty; never part of readiness; a broker outage only delays deliveries.
- **Delivery:** at-least-once. The idempotency key is the event id: `Nats-Msg-Id` (JetStream dedup inside `AEDST_NATS_DUPLICATE_WINDOW_SECONDS`) and the gateway's per-connection dedup beyond it. Clients dedupe on `id`.
- **Format:** the message body is the event envelope `{id, type, version, occurred_at, partition_key, payload}`, pinned by `internal/platform/natsbridge/testdata/envelope.v1.json`, which both the Go test and the Rust gateway's test read. Payload formats are unchanged (existing golden fixtures).
- **Routing:** `partition_key` is the aggregate id (for tasks, the task id), not the recipient. The recipient (`user_id` in the payload, configurable) is carried by the subject `aedst.events.user.<user id>.<event type>`, so the body is unchanged. An event without a valid recipient is cancelled in River, not retried.
- **Gateway (Rust):** `apps/gateway` (crate `aedst-gateway`, Rust 1.100.0, edition 2024): axum `ws` for the WebSocket, `async-nats` for a JetStream pull consumer, `jsonwebtoken` verifying access tokens with the same `AEDST_OIDC_*` settings as the Go server (the gateway is a second OIDC resource server; it issues no tokens), OpenTelemetry, graceful shutdown. No `unwrap()`, no `unsafe`, no committed generated code. Stack and rejections: [library-first/gateway](../../../../docs/content/library-first/gateway.md).
- **Auth exception:** "do not verify JWTs anywhere else" in `apps/server/AGENTS.md` means in Go: the Rust gateway is the one other verifier, because it terminates sockets. It uses the same issuer, audience, algorithms and token types.

## Consequences

- One more stateful dependency to operate (NATS with JetStream, file storage). Mitigated: optional, off by default, outside readiness.
- The Go server's boundary gate changes from "NATS is banned" to "NATS only in `natsbridge`" (`architecturetest.TestOnlyNATSBridgeImportsNATS`, depguard `nats-only-in-natsbridge`).
- Realtime is a nudge, not the source of truth: slow clients are disconnected, events for offline users are dropped (JetStream keeps them for the stream's `MaxAge` for the gateway only); clients resync through the API. Resume from a cursor is not implemented.
- Verification status: Go side verified with an in-process `nats-server`. The Rust gateway is written to the gates (`cargo fmt`, `clippy -D warnings`, `test`, `deny`) but they were **not run** on the authoring machine (no Rust toolchain); see `docs/content/status.md`.

## Revisit when

JetStream operations cost more than they save (then fall back to the River-only path and an in-process gateway), per-user fan-out exceeds what one pull consumer per gateway replica can read (shard by subject), or a second non-Go consumer of events appears (then promote the envelope to a Protobuf contract).
