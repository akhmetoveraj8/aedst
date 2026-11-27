# ADR-0025: When a backend component may be written in Rust

- Status: Accepted (2026-11-28). Narrows the owner decision quoted in
  [ADR-0021](0021-nats-jetstream-and-rust-gateway.md) ("CPU-heavy, latency-critical and systems parts
  may be written in Rust") into a rule that can be checked. Reverses nothing: the gateway stays.
- Scope: everything that runs on the server side (`apps/server`, `apps/gateway`, any future service).
  `apps/desktop` is a client and keeps its own ADR-0001.

## Context

The backend is Go (`apps/server`, a modular monolith of about 49 000 hand-written lines). One Rust
service exists next to it, the WebSocket gateway (`apps/gateway`, about 2 000 lines). "Heavy parts in
Rust" was the stated intent, but "heavy" is not a criterion: in this kind of system the limit is almost
always PostgreSQL, the network or lock contention, and a second language does not move any of them.

A second backend language has a fixed price that is paid whether or not the component is fast:

- a second toolchain, lint set, supply-chain gate (`cargo-deny`) and CI job;
- duplicated platform code (configuration, telemetry, health checks, shutdown) and, worse, duplicated
  security code (until [ADR-0026](0026-gateway-connection-access-and-protobuf-envelope.md) the gateway had
  its own OIDC verifier);
- a contract between the two sides that both test suites must pin;
- fewer people able to debug an incident at 03:00.

The heaviest parts of the backend already run in native code without us writing it: libvips (C)
through govips and imgproxy, Meilisearch (Rust), DragonflyDB (C++), ffmpeg. Buying a hot path is the
cheapest form of "hot path in a systems language".

## Decision

### 1. Order of preference for a hot path

1. **Tune the Go code** (section 2).
2. **Use an existing native component** behind a Go adapter (a library through an existing binding, a
   separate off-the-shelf server, an external process), as was done for images, search and cache.
3. **Write a Rust service**, only when every criterion in section 3 holds.

cgo or FFI from Go into our own Rust code is not an option: it breaks the `CGO_ENABLED=0` default build
and cross-compilation, and puts two runtimes in one process.

### 2. "Go was tuned" means all of these were tried and measured

- a CPU and allocation profile of the real workload (`pprof`, continuous profiling or a load test with
  `task loadtest:*`), attached to the proposal;
- fewer allocations on the hot path (reused buffers, `sync.Pool` where the profile shows allocation cost,
  no `fmt`/reflection-based encoding in the loop);
- garbage collector settings: `GOMEMLIMIT` sized to the container, `GOGC` tested;
- profile-guided optimisation (`default.pgo` from the production profile);
- the obvious algorithmic and I/O fixes (batching, fewer round trips, the right index).

### 3. Admission criteria for a Rust component (all must hold)

| # | Criterion | Evidence in the proposal |
|---|---|---|
| R1 | **The bottleneck is CPU or memory in our process, not I/O.** | Profile: more than half of the time or memory of the hot path is in our code or the Go runtime (GC, scheduler, per-goroutine memory), not in waiting on PostgreSQL, the network or a lock. |
| R2 | **Go was tuned (section 2) and still misses a stated target.** | Before/after numbers for each step, and the target (p99 latency, connections per replica, cost per replica) it still misses. |
| R3 | **No existing component does it** (section 1, step 2). | The candidates looked at and why each was rejected. |
| R4 | **The contract is narrow and machine-checked.** | The interface is a Protobuf message or service under `apps/server/api/proto`, generated for both sides at build time; no hand-mirrored types, no JSON shape known only by tests. |
| R5 | **It owns no business rule and no security decision of its own.** | Authorisation, token verification, validation of user input and domain logic stay in Go; the Rust side asks Go (see ADR-0026). |
| R6 | **It can be switched off or replaced.** | A configuration switch with a documented fallback, as ADR-0023 requires of every optional part. |
| R7 | **It is verified before it counts as architecture.** | One green CI run of format, lint (`clippy -D warnings`), tests, `cargo-deny` and an end-to-end test with the Go side. Until then the component is EXPERIMENTAL in `docs/content/status.md` and off by default. |

A proposal that meets R1-R6 is a new ADR; R7 is the exit condition of its status.

### 4. The gateway against these criteria

| # | Status of `apps/gateway` on 2026-11-28 |
|---|---|
| R1 | **Not measured.** The expected benefit (memory per idle socket, no GC pauses on fan-out) is plausible for WebSocket fan-out but has no profile behind it. |
| R2 | **Not measured.** There is no Go WebSocket implementation to compare with (rejected by owner decision in ADR-0021). |
| R3 | Met: no off-the-shelf server delivers our events with our authorisation. |
| R4 | **Met by ADR-0026**: the NATS body is `aedst.events.v1.EventEnvelope`, generated for Go (`buf generate`) and Rust (`connectrpc-build` with `buffa`). |
| R5 | **Met by ADR-0026**: the gateway no longer verifies OIDC tokens; it asks the Go server (`RealtimeService.GetConnectionAccess`) who a client is. |
| R6 | Met: `AEDST_NATS_URL` empty switches the bridge off; the fallback is polling (ADR-0023). |
| R7 | **Open**: `gateway-ci` has never run green. The gateway stays EXPERIMENTAL and off by default. |

The gateway is kept (owner decision), but R1 and R2 are owed: before realtime is enabled for real
users (ADR-0023, section 1), a load run must show connections per replica and memory per connection,
so the decision rests on numbers. If the numbers show Go would have been enough, that is recorded here
and the gateway is still kept unless its cost becomes a problem.

## Consequences

- "This part is heavy, write it in Rust" is no longer a reason in a review or a proposal; a profile
  and the table above are.
- New backend Rust code is rare and arrives with a Protobuf contract, a switch and a CI job.
- The review checklist of the server (`docs/agent/review/server.md`) and the forbidden list in
  `docs/agent/rules.md` point here.

## Revisit when

A second Rust backend component is proposed (then check whether the shared platform code, such as
configuration and telemetry, should become a shared crate), or the gateway's load run shows the
criteria are too strict or too loose for the workloads we actually have.
