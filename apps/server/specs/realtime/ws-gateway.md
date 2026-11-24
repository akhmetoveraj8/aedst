# Spec: realtime/ws-gateway

Type: Command (event forwarding) + new service
Module: platform/events (Go) + new Rust service `apps/gateway`
Status: Approved (owner, 2026-11-18); Implemented on the Go side, written but not compiled on the Rust side (see "Implementation notes")

## Context

Owner decisions: Rust (1.100.0) for latency-critical and system parts; WebSocket
served by Rust, not `coder/websocket`; NATS JetStream is allowed as the broker that
carries events to the Rust gateway. ADR-0014 said "NATS is not adopted now,
`events.Publisher` is the seam, the bridge is a River-delivered consumer
(`platform.event_forward`), never a dual write". This spec implements exactly that
bridge. ADR-0008 (Realtime: Proposed) gets a new ADR superseding its DragonflyDB/Connect
stream proposal for transport; ADR-0014 gets an "amended by" note.

Not in scope: client (web/Android/Apple/Desktop) WebSocket code, presence/typing,
client->server messages, resume from a cursor (see Open questions).

## Proposed names and library choices (registry-checked 2026-11-18)

- Service: `apps/gateway`, crate/binary `aedst-gateway` (Cargo workspace is not shared
  with `apps/desktop`; own `Cargo.toml`, `rust-toolchain.toml` = `1.100.0`, edition 2024).
- WebSocket: compared `tokio-tungstenite` 0.30.0, `axum` 0.8.9 (`ws` feature, built on
  tungstenite), `fastwebsockets` 0.10.0 (6.6M downloads vs 367M / 601M, last release
  2026-01). Recommendation: **axum 0.8.9 with `ws`**: it gives the HTTP upgrade,
  `/livez` `/readyz`, graceful shutdown and tower layers (limits, timeouts) without
  hand-written protocol code. Fallback: `tokio-tungstenite` alone if the owner wants no
  HTTP framework in the gateway. fastwebsockets rejected (small adoption, one maintainer).
- Broker client: `async-nats` 0.53.0 (JetStream pull consumer, explicit ack).
- JWT: `jsonwebtoken` 12.0.0 (JWKS from `AEDST_OIDC_JWKS_URL` or discovery, cached,
  refreshed on unknown `kid` with a rate limit). `openidconnect` 4.1.0 is a client
  library and does not validate resource-server access tokens, so it is not used here.
  The small JWKS cache is project-specific code; no crate does it better (to re-check
  in `add-dependency`).
- Observability: `opentelemetry` / `opentelemetry_sdk` / `opentelemetry-otlp` 0.33.1,
  `tracing` 0.1.44 + `tracing-opentelemetry` 0.34.0. `tokio` 1.54.1, `serde` 1.0.229.
- All versions UNVERIFIED as compiling together: no `cargo` on the authoring machine.
  Rust 1.100.0 itself is UNVERIFIED here (taken from the owner's decision).

## Scenarios

**Happy path**

- Given a client holds a valid access token (issuer, audience, alg, `typ` per the same
  `AEDST_OIDC_*` as the Go server) and the gateway is subscribed to JetStream stream
  `AEDST_EVENTS`
- When the client connects `GET /v1/ws` (WebSocket upgrade) with
  `Authorization: Bearer <jwt>` (or subprotocols `aedst.v1` + `aedst.bearer.<jwt>` for browsers)
- Then the gateway verifies the token, registers the connection under the token's `sub`,
  and every event whose `partition_key` equals that user id is sent as one text frame
  containing the unchanged event JSON envelope.

**Go side**

- Given a module calls `events.Publisher.Publish` (unchanged signature) in its tx
- When River runs the new `platform.event_forward` job (inserted in the same tx as one
  more "consumer", so `river_job` stays the outbox)
- Then the worker publishes to subject `aedst.events.<event_type>` with header
  `Nats-Msg-Id = <event id>` and waits for the JetStream publish ack; failure returns an
  error and River retries with backoff (10 attempts, then discard + alert metric).

**Edge cases**

- Duplicate delivery (River retry after ack lost): JetStream dedups by `Nats-Msg-Id`
  inside the stream's `duplicate_window` (>= 2 min, set above the longest in-flight
  retry the worker does itself); beyond that window the Rust gateway dedups per
  connection on event id (bounded LRU). Clients are told delivery is at-least-once and
  must dedupe on `id`.
- Invalid/expired token at upgrade: 401, no upgrade. Token expires while connected:
  server closes with code 4401 at `exp`; client reconnects with a fresh token.
- Slow client: bounded per-connection queue (default 256 frames); overflow closes the
  connection with 4429 (client resyncs through the normal API). Never blocks the NATS consumer.
- No consumers connected for a user: event is acked and dropped (the API is the source
  of truth; realtime is a nudge, as in ADR-0008).
- SIGTERM: stop accepting, send close 1012 (service restart) with jittered reconnect hint
  in the reason, drain acks, exit within `AEDST_GATEWAY_SHUTDOWN_SECONDS` (default 20).
- NATS down: `/readyz` fails, existing sockets stay open, consumer reconnects with backoff.
- Event type not in the allowlist for realtime: not forwarded by Go (the forward consumer
  subscribes per event type, so adding a type is an explicit one-line change).

## Errors

| Condition | `sharederrors.Kind` | `connect.Code` |
| --------- | ------------------- | -------------- |
| (Go forward job) NATS unreachable or no ack | n/a (River retry, not an RPC) | n/a |
| (Gateway) bad/missing token | HTTP 401 | n/a (not ConnectRPC) |
| (Gateway) too many connections per user (default 8) | HTTP 429 at upgrade | n/a |

## API

WebSocket, server -> client only in v1 (client text frames are ignored; ping/pong handled
by the library; idle timeout 60 s).

```
GET /v1/ws            Upgrade: websocket
GET /livez /readyz    200/503
```

Frame (text, UTF-8 JSON, identical to the event as stored in the River job):

| Field | Type | Required | Description |
| ----- | ---- | -------- | ----------- |
| `id` | string (UUIDv7) | yes | event id = idempotency key |
| `type` | string | yes | e.g. `tasks.v1.TaskCompleted` |
| `version` | uint32 | yes | event version |
| `occurred_at` | RFC 3339 UTC | yes | commit-side timestamp |
| `partition_key` | string (UUID) | yes | routing key; the owner user id for user events |
| `payload` | object | yes | producer's JSON, untouched |

The NATS message body is this same JSON: **the format does not change**. Golden tests: a
Go test serialises the envelope via `eventstest`/`goldentest` fixtures
(`architecturetest/event_fixtures_test.go` already guards the payloads) and a Rust test
parses the same files from `apps/server/testdata` so both sides are pinned to one fixture.
Note: the existing `Event` struct has no envelope JSON today (River job args are the
nearest shape); the envelope is defined here and frozen by the new golden file.

Config (env, `AEDST_` prefix): `AEDST_OIDC_{ISSUER,AUDIENCE,JWKS_URL,ALGORITHMS,TOKEN_TYPES,CLOCK_SKEW_SECONDS}`
(same meaning and defaults as Go), `AEDST_NATS_URL`, `AEDST_NATS_STREAM` (default
`AEDST_EVENTS`), `AEDST_GATEWAY_ADDR`, `AEDST_GATEWAY_*` limits (table below), `OTEL_EXPORTER_OTLP_*`.
Go adds `AEDST_NATS_URL` (optional: empty = no forward consumer, nothing changes for
deployments without the gateway).

Gateway settings (all optional; numbers must be positive):

| Variable | Default | Meaning |
| -------- | ------- | ------- |
| `AEDST_GATEWAY_ADDR` | `0.0.0.0:8090` | listen address |
| `AEDST_GATEWAY_ALLOWED_ORIGINS` | (empty) | comma-separated browser origins (`scheme://host[:port]`) that may open a socket. Empty refuses every request that carries `Origin`; clients without `Origin` are authenticated by the token alone. Invalid entries stop the start |
| `AEDST_GATEWAY_ALLOW_ANY_ORIGIN` | `false` | local development opt-out of the origin check; the gateway refuses to start with it in `staging` or `production` |
| `AEDST_GATEWAY_MAX_CONNS` | `10000` | open sockets per replica (503 above it) |
| `AEDST_GATEWAY_MAX_CONNS_PER_USER` | `8` | open sockets per owner id (429 above it) |
| `AEDST_GATEWAY_MAX_HANDSHAKES` | `1024` | connections still in the HTTP phase; the listener stops accepting above it |
| `AEDST_GATEWAY_HEADER_TIMEOUT_SECONDS` | `5` | time a client has to send its request headers |
| `AEDST_GATEWAY_SEND_QUEUE` | `256` | frames buffered per socket before it is closed with 4429 |
| `AEDST_GATEWAY_IDLE_TIMEOUT_SECONDS` | `60` | silence (no frame, no pong) before close 4408 |
| `AEDST_GATEWAY_SHUTDOWN_SECONDS` | `20` | grace period after SIGTERM |

Handshake contract (v1): `Authorization: Bearer <jwt>`, or, for browsers, the subprotocols
`aedst.v1` and `aedst.bearer.<jwt>` offered together (`new WebSocket(url, ["aedst.v1", "aedst.bearer." + token])`).
The gateway selects `aedst.v1` only; the token never appears in a response. A token subprotocol
without `aedst.v1` is answered with 400. `/readyz` is 200 only while the consumer is attached; its body is
`consumer=<connecting|attached|retrying|stopped> reconnects=<n> connections=<n>`.

## Events

| Event type | Version | partition_key | Payload | Consumers |
| ---------- | ------- | ------------- | ------- | --------- |
| existing `tasks.v1.*` types (first allowlist entry: `tasks.v1.TaskCompleted`) | unchanged | unchanged | unchanged | + `platform.event_forward` (River) -> NATS -> gateway |

No new event type, no payload change.

## Cross-module dependencies

None between Go modules. `platform/events` gains `internal/platform/natsbridge`
(only package allowed to import `github.com/nats-io/`; depguard + architecturetest rule
changed from "banned" to "only there"). It is a River worker reached through the existing
`Registry.Subscribe`; domain/application never import it.

## NFR

- Idempotency: key is the event id (`Nats-Msg-Id` + gateway LRU); no `Idempotency-Key` header (no client writes).
- Timeout: JetStream publish 5 s; WebSocket handshake 10 s; verify JWKS fetch 3 s.
- Hot path: yes for the gateway (one task per socket, no per-frame allocation beyond the frame; load test is a follow-up, no numbers claimed).
- Rust rules: no `unwrap()`/`expect()`/`unsafe` (`clippy::unwrap_used`, `unsafe_code = "forbid"`), no committed generated code, `cargo fmt/clippy -D warnings/test/deny`.
- Security: tokens never logged; Origin allowlist for browsers; per-IP and per-user connection limits; max frame size.

## Docs/gates changed in the implementation PR

New ADR (server ADR-0021 "NATS JetStream and a Rust WebSocket gateway": supersedes the
"not adopted" clause of ADR-0014 and the realtime transport of ADR-0008, revisit-when),
`decisions/server.md`, `library-first/server.md` (NATS un-forbidden, scoped), new
`library-first/gateway.md` (Rust page), `apps/server/AGENTS.md` and root `AGENTS.md`/
`docs/agent/rules.md`/PR template (ban lists), `.golangci.yml` depguard,
`architecturetest/boundaries_test.go` + `approved_modules.txt` (`github.com/nats-io/nats.go`),
`docs/agent/INDEX.md` row, Taskfile `gateway:*`, `task verify:gateway`, CI workflow.

## Verification honesty

This machine has **no `cargo`, `rustup`, `task` or `docker`** (Go 1.27.3 only). Go unit and
golden tests can run here. `cargo fmt/clippy/test/deny` and the Go -> NATS -> Rust -> WS
integration test cannot be run here; I will write them (Go-side harness using testcontainers
for NATS + Postgres like the existing `events_integration_test.go`, driving the built gateway
binary and a WS client), but will report them as **not executed** unless a toolchain
appears. Android, Apple and Desktop are untouched and not claimed to build.

## Open questions for the owner

1. Routing: is `partition_key` the recipient user id for the events that should reach clients? (If not, the forwarded envelope needs a `recipient_user_ids`/audience field, which changes the format you asked to keep.)
2. axum (recommended) vs bare `tokio-tungstenite` for the gateway.
3. Browser auth: accept `aedst.bearer.<jwt>` subprotocol, or require first-message auth?
4. Install a Rust toolchain (+ Docker, `task`) here, or accept CI-only verification?

## Implementation notes (deviations from the draft, 2026-11-18)

- **Routing (open question 1 resolved without changing the body):** `partition_key` is the aggregate id (for tasks, the task id), not the recipient. The Go bridge reads the recipient from the payload field `user_id` (`AEDST_NATS_RECIPIENT_FIELD`) and publishes to subject `aedst.events.user.<user id>.<event type>`; the body stays the unchanged envelope. An event without a valid UUID there is cancelled in River.
- **Owner id:** the gateway maps a token's `(iss, sub)` to the owner id exactly like Go `ids.FromExternal` (a UUID `sub` as is, otherwise a version-8 UUID hashed with the issuer); shared test vectors in `natsbridge/testdata/user_id_vectors.json`.
- **Consumer name:** the bridge is a River consumer per forwarded type named `platform.nats_forward:<type>` on the existing `platform.event_delivery` job kind (not a new job kind).
- **Gateway consumer:** ephemeral pull consumer per replica, `DeliverPolicy::New`, explicit ack; the Go bridge owns the stream (created at startup, best effort, and on the first event).
- **Browsers:** token via `Authorization: Bearer` or WebSocket subprotocol `aedst.bearer.<jwt>` (open question 3: subprotocol accepted). Changed 2026-11-21: the client must also offer `aedst.v1`, which is the only name the gateway selects (the first draft echoed the token subprotocol back). No client used the old handshake.
- **Hardening pass 2026-11-21 (not compiled):** origins fail closed, header-read timeout and connection caps (`hyper-util` accept loop instead of `axum::serve`), consumer reconnect with capped backoff and jitter, consumer state in `/readyz` and two OTLP metrics.
- **Framework:** axum 0.8.9 (open question 2).
- **Verification:** open question 4 stands: no Rust toolchain was installed, so the Rust side is not compiled. The Go side and the shared fixtures are tested.
- **Not done:** per-IP connection limits, connection and delivery metrics (only the two consumer metrics exist), resume from a cursor, load test.
