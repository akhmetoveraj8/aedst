# apps/gateway - AI agent instructions

The realtime gateway: Rust 1.100.0, edition 2024 (ADR-0020). Read the root [AGENTS.md](../../AGENTS.md) and
[CONVENTIONS.md](../../CONVENTIONS.md) first. Spec: [specs/realtime/ws-gateway.md](../server/specs/realtime/ws-gateway.md).
Approved crates: [library-first/gateway](../../docs/content/library-first/gateway.md). Why NATS and Rust:
[ADR-0020](../server/docs/adr/0020-nats-jetstream-and-rust-gateway.md).

Verification status: written without a Rust toolchain on the authoring machine. `cargo fmt`, `clippy -D warnings`, `test`
and `deny` and the Go to NATS to Rust to WebSocket test have NOT been run; crate features marked UNVERIFIED in `Cargo.toml`
are unchecked. Do not claim it builds until `task gateway:lint gateway:test gateway:deny` has run. Android, Apple and
Desktop are untouched.

| When you | Use |
|---|---|
| Forward another event type to clients | Add it to `AEDST_NATS_FORWARD_TYPES` (Go side). The gateway needs no change: it routes by subject `aedst.events.user.<user id>.<type>` and forwards the body bytes unchanged |
| Change the frame or the subject | Never here first: the Go `natsbridge` owns the format. Change `testdata/envelope.v1.json` there; `tests/envelope.rs` must keep passing |
| Verify a token | `auth::Verifier` only (same `AEDST_OIDC_*` as the Go server); never a second JWT crate, never log a token |
| Map a subject (`sub`) to an owner id | `auth::user_id_for` (mirror of Go `ids.FromExternal`, pinned by `testdata/user_id_vectors.json`) |
| Add a client-to-server message | A spec first: v1 is server to client only, client frames are ignored |
| Handle an error | `thiserror` enums; no `unwrap()`/`expect()`/`panic!` (clippy denies them outside tests), no `unsafe` (forbidden) |
| Log | `tracing` macros, never `println!`; no tokens or payloads in logs |
| Add a dependency | `add-dependency` skill: registry-verified version in `Cargo.toml`, Library-First page in the same change |
| Generated code | None is committed; `Cargo.lock` is the only lock file and is committed once generated (`cargo generate-lockfile`) |
