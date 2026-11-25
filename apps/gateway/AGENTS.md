# apps/gateway - AI agent instructions

The realtime gateway: Rust 1.100.0, edition 2024 (ADR-0021). Read the root [AGENTS.md](../../AGENTS.md) and
[CONVENTIONS.md](../../CONVENTIONS.md) first. Spec: [specs/realtime/ws-gateway.md](../server/specs/realtime/ws-gateway.md).
Approved crates: [library-first/gateway](../../docs/content/library-first/gateway.md). Why NATS and Rust:
[ADR-0021](../server/docs/adr/0021-nats-jetstream-and-rust-gateway.md).

Verification status: written without a Rust toolchain on the authoring machine. `cargo fmt`, `clippy -D warnings`, `test`
and `deny` and the Go to NATS to Rust to WebSocket test have NOT been run. Versions and feature names in `Cargo.toml` exist
on crates.io (checked 2026-11-21); that they are sufficient is UNVERIFIED. Do not claim it builds until
`task gateway:lint gateway:test gateway:deny` has run. Conventions: [conventions/gateway](../../docs/agent/conventions/gateway.md).

| When you | Use |
|---|---|
| Forward another event type to clients | Add it to `AEDST_NATS_FORWARD_TYPES` (Go side). The gateway needs no change: it routes by subject `aedst.events.user.<user id>.<type>` and forwards the body bytes unchanged |
| Change the frame or the subject | Never here first: the Go `natsbridge` owns the format. Change `testdata/envelope.v1.json` there; `tests/envelope.rs` must keep passing |
| Verify a token | `auth::Verifier` only (same `AEDST_OIDC_*` as the Go server); never a second JWT crate, never log a token |
| Change the handshake | Contract in the module doc of `ws.rs`: `Authorization: Bearer <token>`, or subprotocols `aedst.v1` + `aedst.bearer.<token>`; the gateway answers `aedst.v1` only and never echoes the token. Browser `Origin` must be in `AEDST_GATEWAY_ALLOWED_ORIGINS` (empty = no browser; `AEDST_GATEWAY_ALLOW_ANY_ORIGIN=true` only outside staging/production) |
| Add a limit or a setting | `config.rs` (`AEDST_GATEWAY_*`, positive, safe default, a test) and the env table in the spec. Existing: `MAX_CONNS` 10000, `MAX_CONNS_PER_USER` 8, `MAX_HANDSHAKES` 1024, `HEADER_TIMEOUT_SECONDS` 5, `SEND_QUEUE` 256, `IDLE_TIMEOUT_SECONDS` 60, `SHUTDOWN_SECONDS` 20 |
| Touch the NATS consumer | It never exits: capped backoff with jitter (`consumer::backoff`), state in `ConsumerHealth` (shown by `/readyz`) and the two `aedst_gateway_consumer_*` metrics |
| Map a subject (`sub`) to an owner id | `auth::user_id_for` (mirror of Go `ids.FromExternal`, pinned by `testdata/user_id_vectors.json`) |
| Add a client-to-server message | A spec first: v1 is server to client only, client frames are ignored |
| Handle an error | `thiserror` enums; no `unwrap()`/`expect()`/`panic!` (clippy denies them outside tests), no `unsafe` (forbidden) |
| Log | `tracing` macros, never `println!`; no tokens or payloads in logs |
| Add a dependency | `add-dependency` skill: registry-verified version in `Cargo.toml`, a line in `approved-crates.txt`, Library-First page in the same change; a crate Desktop also uses keeps the version of `apps/desktop/Cargo.toml` |
| Write to a socket or call the network | Always bounded: `WRITE_TIMEOUT` for socket writes, the client timeout for JWKS; never wait on a client inside `Hub::dispatch` |
| Generated code | None is committed; `Cargo.lock` is the only lock file and is committed once generated (`cargo generate-lockfile`) |

## Gates (run before saying done)

1. `task gateway:lint gateway:test gateway:deny` (`cargo fmt --check`, `clippy --all-targets -- -D warnings`, `cargo test`, `cargo deny check`). Never run yet; the source was reformatted by hand, rustfmt itself was not run, so run `cargo fmt` once first.
2. `bash ../../scripts/rust/check-approved-crates.sh` (no cargo; also in `task check:boundaries` and CI job `dependency-policy`): approved direct dependencies, versions, lint levels and toolchain equal to Desktop.
3. `task check` from the repo root.
4. If step 1 did not run, say that nothing was compiled or tested.
