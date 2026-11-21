# Naming: Gateway (Rust, `apps/gateway`)

Part of [CONVENTIONS.md](../../../CONVENTIONS.md). Levels: **Must** = enforced (linter/CI), **Should** = needs a one-line PR justification to deviate, **Could** = preference.

The gateway is one Rust package (`aedst-gateway`), not part of the Desktop workspace. It follows the same Rust rules as [Desktop](desktop.md); only the differences and the service-specific rules are listed here. Nothing below has been checked by a compiler yet: the gateway was written without a Rust toolchain ([status](../../content/status.md)).

| What | Rule | Example | Level |
|---|---|---|---|
| Rust file / module | `snake_case.rs`, one concern per module | `consumer.rs`, `hub.rs` | Must (`scripts/check-naming.sh`) |
| Types, traits, enum variants | `PascalCase` | `Verifier`, `Outbound::Frame` | Must (rustc lint) |
| Functions, variables | `snake_case` | `user_id_for`, `recipient_of` | Must (rustc lint) |
| Constants | `SCREAMING_SNAKE_CASE`, with the unit in the doc comment | `WRITE_TIMEOUT`, `MAX_CLIENT_MESSAGE` | Must (rustc lint) |
| Errors | one `thiserror` enum per module, named `<Module>Error` | `AuthError`, `HubError` | Should |
| Environment variables | `AEDST_GATEWAY_*` for the gateway's own settings; `AEDST_OIDC_*` and `AEDST_NATS_*` keep the Go server's names and meaning | `AEDST_GATEWAY_SEND_QUEUE` | Must (reviewed; `config.rs` tests) |
| WebSocket close codes | documented once, in the module doc of `ws.rs` and in the spec | `4401`, `4408`, `4429`, `1012` | Should |
| Tests | unit tests in `#[cfg(test)] mod tests`; cross-language contract tests in `tests/<subject>.rs` reading the Go fixtures | `tests/envelope.rs` | Should |
| Public items | every `pub` item has a doc comment (`missing_docs` is a warning and CI denies warnings) | | Must (rustc lint) |

## Service rules (reviewed; the review checklist for a change here)

- No `unwrap()`, `expect()`, `panic!` outside tests (clippy denies them); no `unsafe` (`forbid`).
- Every network call has a timeout: JWKS fetch (`reqwest` client timeout), socket writes (`WRITE_TIMEOUT`), idle sockets (`AEDST_GATEWAY_IDLE_TIMEOUT_SECONDS`), shutdown (`AEDST_GATEWAY_SHUTDOWN_SECONDS`).
- Backpressure: a connection owns a bounded queue; `Hub::dispatch` never waits and evicts a slow connection. Nothing may block the NATS consumer.
- Authentication happens before the upgrade (`auth::Verifier` only). The token arrives in `Authorization` or in the subprotocol `aedst.bearer.<token>` offered together with `aedst.v1`; the response selects `aedst.v1` only and never contains the token.
- Origins fail closed: a request with `Origin` must match `AEDST_GATEWAY_ALLOWED_ORIGINS`; an empty list refuses every browser. `AEDST_GATEWAY_ALLOW_ANY_ORIGIN=true` is the local-development opt-out and is refused in staging and production.
- Limits are configuration with safe defaults: header-read timeout, connections in the HTTP phase, sockets in total and per user, message size (`server.rs`, `hub.rs`, `ws.rs`).
- The NATS consumer never exits: capped exponential backoff with jitter, state in `/readyz` and in the metrics `aedst_gateway_consumer_attached` / `aedst_gateway_consumer_reconnects_total`.
- No token and no event payload in a log line.

## Enforcement gates (apps/gateway)

| Gate | Needs cargo | Where |
|---|---|---|
| `scripts/check-naming.sh` | no | `task check`, `policies-ci.yml` |
| `apps/desktop/scripts/check-approved-crates.sh` (approved direct dependencies, versions shared with Desktop, lint and toolchain parity; rules in [desktop/boundaries](../../content/desktop/boundaries.md)) | no | `task check:boundaries`, `policies-ci.yml`, `gateway-ci.yml` job `dependency-policy` |
| `cargo fmt --check`, `cargo clippy --all-targets -- -D warnings`, `cargo test`, `cargo deny check` | yes | `task gateway:lint gateway:test gateway:deny`, `gateway-ci.yml` (never run) |

The gateway has no feature level: it is one service with one capability (forwarding events to sockets).
