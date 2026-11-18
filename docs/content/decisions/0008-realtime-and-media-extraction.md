---
title: "ADR-0008: Realtime and Media Extraction"
description: "aedst-server (module internal/modules/media) with its own River queue. The original decision to build it as a separate cmd/media deployable was not followed..."
---

# ADR-0008: Realtime and Media Extraction

## Status
- **Media: Accepted as amended.** Media is implemented **in-process** in
  `aedst-server` (module `internal/modules/media`) with its own River queue. The
  original decision to build it as a separate `cmd/media` deployable was **not**
  followed and is superseded by the amendment below.
- **Realtime: Proposed, deferred.** Nothing is implemented: there is no
  `cmd/realtime`, no gateway, no streaming RPC (none is declared in the protos). Since the
  connect v2 migration every interceptor wraps all RPC shapes, and
  `TestChainWrapsStreamingRPCs` proves it. The design below is the intended shape for the day a
  product needs realtime; it is not a commitment to build it now.

History: this ADR first said both would be separate deployables "from line one".
That never happened for media and has no code for realtime, so the text below was
rewritten to describe what exists and what is only planned.

## Context
[ADR-0001](/decisions/0001-modular-monolith) keeps everything in one deployable
until a measured operational reason justifies extraction. Two capabilities have a
resource profile that is known a priori and different from request/response CRUD:

- **Realtime** (chat-style message and presence fan-out): tens of thousands of
  long-lived connections per node, memory-bound rather than CPU-bound, with
  deploys that must not drop every connection at once.
- **Media** (large uploads and downloads): request bodies of megabytes to
  gigabytes that would occupy API connections and inflate tail latency if they
  passed through the monolith.

## Media: decision as implemented (amendment)

The reason extraction was pre-decided, large bodies occupying API connections, does
not apply: bytes never pass through the API. Uploads and downloads use **presigned
direct-to-object-storage URLs** (S3-compatible: S3, R2, MinIO) through the
`ObjectStorage` port; the API authorises the request, issues the short-TTL URL
with size and content-type constraints, and records metadata. Completion is an
explicit `CompleteUpload` RPC; post-processing runs as River jobs.

What does have a different resource profile is processing (decode, resize,
ffmpeg), and that is isolated by a dedicated River queue instead of a second
codebase:

- Processing jobs run on queue `media`. `AEDST_JOBS_QUEUES` (default
  `default=50,media=2`) chooses which queues a process works; the same binary
  deployed as a worker with `media=4` and API replicas with `default=50` gives
  media its own scaling and failure domain.
- The module honours the same contract as every module: `api/` package seam
  ([ADR-0006](/decisions/0006-module-boundaries)), Protobuf/ConnectRPC contracts
  ([ADR-0002](/decisions/0002-connectrpc)), events through the transactional
  River path (ADR-0014), and it never reads another module's tables. It reaches
  tasks only through `tasks/api` (the `TaskOwnership` port).
- Extraction into its own deployable (steps, seams and open blockers: [extraction runbook](/server/runbook-extract-service)) remains the next
  step if measurement shows the queue split is not enough. Triggers: media
  processing starves default-queue jobs despite the queue split, or its memory
  profile (libvips, ffmpeg) forces node sizing the API does not need.

Image renditions are served by imgproxy ([ADR-0015](/decisions/0015-govips-and-imgproxy-media-pipeline)).

## Realtime: proposed design (superseded in part by ADR-0020)

> 2026-11-18: the transport is now a Rust WebSocket gateway (`apps/gateway`) fed by NATS JetStream, see [ADR-0020](../../../apps/server/docs/adr/0020-nats-jetstream-and-rust-gateway.md). The Valkey pub-sub and ConnectRPC-streaming proposals below are not pursued.

- The gateway is **stateless**: connection state is only the socket; the source of
  truth for messages and subscriptions is Postgres, so any gateway instance can be
  killed and clients reconnect and resume from a cursor.
- **Ephemeral fan-out uses Valkey pub-sub** (presence, typing indicators, "new
  message" nudges): it is already a platform dependency, has minimal latency and
  no persistence cost, and losing a message is acceptable because clients resync
  from the cursor. **Durable delivery uses River jobs inserted transactionally**
  (as with every other event): a message is committed first and then announced.
  NATS JetStream is adopted only when cross-service fan-out with replay is proven
  necessary by measurement (see [ADR-0004](/decisions/0004-nats-jetstream)).
- Transport: **ConnectRPC server streaming** wherever the client can use it
  (Connect-ES on web, Connect-Swift, Connect-Kotlin), keeping one contract and one
  auth/interceptor stack. **WebSocket** (or SSE) only for clients that cannot
  consume Connect streams (for example the Qt desktop client if its stack lacks
  support), behind the same gateway.
- Graceful shutdown drains by sending a reconnect hint with jitter so a deploy does
  not cause a thundering herd.

Preconditions before any of this is built (none is met today):
1. A product feature that needs push-style delivery beyond Web Push/FCM/APNs
   notifications (which exist, module `notifications`).
2. ~~Streaming-aware interceptors~~ (done by the connect v2 migration: `connect.ServerInterceptor` wraps every RPC shape, see decision in decisions/server). Left: stream-level policy (auth, roles, rate
   limits) and removal of the no-streaming guard test in the same change.
3. A decision whether realtime is a module of `aedst-server` first (ADR-0001's
   default) or a separate deployable from the start. The original "separate from
   line one" stance is a proposal that rests on the resource profile above, not on
   measurement; revisit with a prototype and numbers.

## Consequences
- The core API stays a single deployable; media's heavy work is insulated by the
  River queue split, not by a second service.
- Presigned URLs move authorisation to URL issuance: TTLs, scoped keys and
  content-length constraints are security-critical and have tests.
- Valkey pub-sub is at-most-once. Any realtime feature needing guaranteed delivery
  must use the transactional River path, and that must be visible in its design.
- Realtime has no code, no Helm chart and no dashboard; docs that mention it
  describe a plan.
- If the measured triggers for other modules (see ADR-0001 and
  [architecture.md](/server/architecture#extraction-path)) fire later, they follow
  the same pattern.
