---
title: "AEDST Backend Architecture"
description: "The backend (apps/server) ships as a single deployable — aedst-server — but is internally partitioned into independent modules with enforced boundaries. A..."
---

# AEDST Backend Architecture

## Principle

**Monolith first, boundaries first, microservices later.**

The backend (`apps/server`) ships as a single deployable — `aedst-server` — but is
internally partitioned into independent modules with enforced boundaries. A module
is extracted into its own service only when there is a measured, concrete reason
(traffic, independent scaling/deployment, failure isolation, team ownership). Until
then, nothing outside this repo can tell it isn't already distributed: every
cross-module call goes through the same kind of contract (a Go interface today, a
network RPC tomorrow) and every module owns its own data.

## Current phase

```
Shape 1: Modular Monolith   <-- the default; nothing configured
Shape 2: Module Services    AEDST_MODULES=chat   (one binary, one module per deployment)
```

The module is the unit of extraction. A feature (below) is a slice inside a module and is never deployed on
its own (owner decision of 2026-11-21, [modules and features](/architecture/modules-and-features); it
supersedes the "feature services" shape of ADR-0020). The shapes are **configuration of the same binary**, not phases that need a rewrite
([ADR-0020](../../../apps/server/docs/adr/0020-location-transparent-units.md)): see [Units and topology](#units-and-topology).
Which shape a deployment uses is decided by measurement ([ADR-0001](/decisions/0001-modular-monolith)),
not by the code.

See [modules.md](/server/modules) for the module list and dependency graph,
[database.md](/server/database) for data ownership, [events.md](/server/events) for the
integration-event catalog, and [decisions/](/decisions) for the ADRs behind these
choices.

## Request flow (Phase 1)

```
                 Cloudflare (future)
                        |
                     Envoy (future)
                        |
              ConnectRPC (Connect / gRPC)
                        |
               AEDST Modular Monolith
                        |
        +---------------+---------------+
        |               |               |
     Modules        Platform        Contracts
        |               |               |
     auth            config          proto (buf)
     tasks           database        events
     ...             cache
                      events (River InsertTx)
                      observability
                      auth (jwx)
                        |
        +---------------+---------------+
        |               |               |
   PostgreSQL         DragonflyDB
   (PgBouncer)
```

Locally, `Cloudflare -> Envoy` is skipped: the process listens directly on
`:8080` (ConnectRPC, which also speaks plain HTTP/1.1 + JSON for browsers/curl)
and `:9090` (metrics).

## Repository layout

```
apps/server/
├── cmd/server/            entrypoint: platform wiring + iterating the module registry; no business logic, names no module (modules.go = one import per module)
├── internal/
│   ├── platform/          cross-cutting infrastructure, shared by every module
│   │   ├── config/        env-driven configuration (caarlos0/env)
│   │   ├── database/      pgx pool, tx helpers
│   │   ├── cache/        DragonflyDB RESP client (go-redis): cache + rate limiting only
│   │   ├── events/        integration events: Publisher (River InsertTx per consumer), Registry, delivery worker (the seam for a broker)
│   │   ├── idempotency/   Idempotency-Key replay (per-caller scope, advisory-locked)
│   │   ├── retention/     River periodic purge jobs for append-only tables
│   │   ├── jobs/          River client wiring, queue-lag metrics
│   │   ├── observability/ slog, OpenTelemetry (OTLP); Prometheus /metrics optional
│   │   ├── lock/          Postgres advisory locks (no Redlock/RedSync)
│   │   ├── auth/          OIDC resource-server verification (jwx v4 + jwkfetch); the only authentication (ADR-0019)
│   │   ├── modulekit/     module registry: Register, dependency order, Env, the one Mounter (protovalidate, limits)
│   │   ├── buildinfo/     server version (ldflags, VCS revision)
│   │   └── httpserver/    ServeMux router, middleware stack, interceptors (auth, roles, client-version gate)
│   ├── modules/           one bounded context per directory, see modules.md
│   └── shared/            genuinely generic primitives only (ids, pagination,
│                          errors, time) — never a dumping ground
├── api/proto/             contract-first protobuf definitions (buf)
├── gen/                   generated code (buf generate, sqlc generate) — never
│                          hand-edited
├── sql/                   sqlc queries, per module
├── migrations/            goose migrations, per module (schema-per-module)
├── deployments/docker/    docker-compose for local dev
├── architecturetest/      static checks that fail CI on boundary violations
└── Makefile
```

## API contract: proto, Buf, Bruno

`api/proto/` is the single source of truth every client (`apps/web`,
`apps/apple`, and this server's own Go stubs) generates from — see each
app's `buf.gen.yaml`. `apps/server/buf.yaml` is the only lint/breaking
config in the repo: `STANDARD` lint rules, `FILE`-level breaking-change
detection. `make lint` (`apps/server`) runs `buf lint` and
`buf format -d --exit-code`; `make breaking` diffs the current branch
against `main`. CI (`.github/workflows/server-ci.yml`) runs the same three
checks on every PR touching `apps/server/**`, plus a check that `gen/`
isn't stale relative to `api/proto/`.

ConnectRPC has no generated try-it-out page the way OpenAPI/Swagger does —
[`apps/server/api/bruno/`](../../../apps/server/api/bruno/README.md) fills
that gap: a git-committed [Bruno](https://www.usebruno.com/) collection
covering every public procedure, with auth-token chaining
(`script:post-response` captures `accessToken`/`refreshToken` after
Register/Login) and negative tests for the 401 (bad token) and 403
(cross-user `UpdateProfile`) paths.

## Module boundary rules

1. A module is a bounded context. It owns its domain model, its tables (own
   Postgres schema), and its own read/write path.
2. Other modules — and `cmd/server` wiring aside — may only depend on a module's
   `api/` package (its public Go interface: commands, queries, DTOs). Importing
   `modules/x/domain`, `modules/x/infrastructure`, `modules/x/repository` or
   `modules/x/transport` from outside module `x` is a boundary violation and is
   caught by `architecturetest` (see [ADR-0006](/decisions/0006-module-boundaries)).
3. Cross-module reads that would otherwise require a SQL join go through the
   owning module's `api/` package, or through a local read-model/projection
   built from that module's domain events — never direct SQL against another
   module's schema.
4. A module's internal layering is one-directional:
   `transport -> api -> application -> domain`, `infrastructure -> application/domain
   interfaces`. Transport imports only its own `api/` (never `application` or `domain`);
   `domain` never imports `infrastructure`.
5. Interfaces are defined where they are consumed (e.g. `UserRepository` lives in
   `application`, implemented in `infrastructure/postgres`), not created
   speculatively for every type.

## Extraction path

With [ADR-0020](../../../apps/server/docs/adr/0020-location-transparent-units.md) most of this is configuration (see
[Units and topology](#units-and-topology) and the [runbook](/server/runbook-extract-service)). The list below
is what the configuration relies on. A module already respects rules 1–4 above, so promoting it is mechanical,
not a rewrite:

1. Freeze the module's `api/` contract.
2. Confirm it has zero direct DB access into another module's schema (rule 3
   guarantees this if it was never violated).
3. Replace any remaining in-process calls to the module's `api/` package with a
   ConnectRPC client generated from the same proto contract.
4. Move the module's package tree to its own `cmd/`, give it its own database
   (its schema already has clean ownership boundaries under rule 1).
5. Where the in-process call was previously synchronous but doesn't need to be,
   replace it with an integration event. If the event's consumer becomes its own
   service, plug a broker adapter behind `events.Publisher`
   ([ADR-0014](/decisions/0014-river-insert-tx-as-outbox)); producers and
   consumer handlers do not change.
6. Deploy independently, measure, and only then consider splitting further.

No module in Phase 1 is extracted preemptively — see
[ADR-0001](/decisions/0001-modular-monolith).

## Units and topology

A **unit** is what `modulekit.Register` registers and what a process hosts or reaches over the network: a
module. It has an `api/` contract, its own schema, events and a `module/` registration.

A module with more than one capability is split into **features**, which are vertical slices inside the
unit, not units ([modules and features](/architecture/modules-and-features)):

```
internal/modules/<module>/
    api/                          the contract (Go interfaces, events); shared by the features
    domain/                       entities and vocabulary two or more features use
    infrastructure/<pkg>/         shared persistence helpers (tasks: store)
    transport/<pkg>/              shared proto mapping (tasks: taskproto)
    module/                       registration; the ONLY package that imports features and composes them
    features/<feature>/
        application/ domain/ infrastructure/ transport/     only these four, any subset
migrations/<module>/   sql/<module>/                         one schema and one sqlc package per module
```

| Rule | Gate (`architecturetest`) |
|---|---|
| A feature never imports another feature; a shared package imports no feature; nothing outside the module imports a feature | `TestFeaturesMeetOnlyThroughTheirModule` |
| Layer rules hold inside a feature and from a feature to the module's shared packages (a feature's `transport` sees only `api/` and shared `transport/`, its `domain` only the shared `domain/`) | `TestLayersOnlyImportInward`, `TestDomainImportsOnlyStdlibAndShared` |
| A feature directory holds only the four layers; a module with `features/` has no module-level `application/` | `TestEveryFeatureHoldsOnlyTheKnownLayers` |
| Every feature is wired by `<module>/module` | `TestEveryFeatureIsComposedByItsModule` |

Reference: `internal/modules/tasks` (`core`, `completion`, `reminders`, `operator`). One proto service can
span features: `TasksService` is served by `core` and `completion` handlers that `module/compose.go` embeds in
one struct, and `api.Service` is the same composition of their use cases. A feature that needs another one
gets a port, wired in `module/` (`core` enqueues the reminder through `ReminderEnqueuer`, implemented by
`reminders`). Add a feature with `task new:feature -- MODULE=<module> NAME=<feature>`.

**Topology** is environment, resolved by `modulekit.Select` at startup:

| Variable | Meaning |
|---|---|
| `AEDST_MODULES` | units (modules) hosted by this process; empty = all |
| `AEDST_MODULE_<NAME>_URL` | base URL of a required unit that is not hosted here |

A hosted unit that `Requires` a unit that is neither hosted nor reachable fails startup and names the variable
to set. For a remote unit the unit's own `Module.Remote` hook runs instead of `Setup` and provides the same
`api/` interfaces as Connect clients (`modulekit.NewClient`: deadline, breaker, rate limit, tracing, bearer
forwarding), so a consumer's `modulekit.Require[api.X]` is unchanged. Only a unit whose contract is
network-safe declares `Remote` (values in and out, `context.Context` first, `error` last; enforced by
`architecturetest.TestRemoteHooksProvideNetworkSafeContracts`), and each such contract has one shared suite run
against the in-process and the Connect implementation (`tasks/api/ownershiptest`).

Worked example: `media` asks `tasks` whether a task belongs to the caller (`tasksapi.Ownership`). In the
monolith that is a function call; with `AEDST_MODULES=media` and `AEDST_MODULE_TASKS_URL=http://tasks:8080` it
is a `TasksService.GetTask` call carrying the user's token, with identical results. Two tests pin it:
`internal/modules/tasks/module/extraction_test.go` (no database: both topologies resolved from the environment,
the real transport and `Remote` hook, the call observed on the wire) and the `integration`-tagged
`cmd/server/extraction_integration_test.go` (the binary started twice on Postgres).

`Remote` hooks today: `tasks` (`Ownership`), `media` (`Stats`), `notifications` (a marker; `admin` builds its
operator client). `search`, `integrity`, `appattest`, `capabilities` and `admin` have none: no other unit calls
them synchronously, and a hook is added together with a narrow network-safe contract when one does.

## Module registry

`internal/platform/modulekit` is the seam between `cmd/server` and the modules.
A module declares itself once, from the `init()` of its `module/` package:

| Field | Meaning |
|---|---|
| `Name` | the directory name under `internal/modules` |
| `Requires` | modules whose `Setup` must run first (`media` requires `tasks`; `admin` requires `auth`, `media`, `notifications`, `tasks`). Startup order is dependency order, ties by name; an unknown name or a cycle fails startup |
| `Setup(ctx, env)` | builds services from `env` (config, pools, River client, event publisher, push dispatcher), registers River workers and event consumers, and publishes what others may use with `modulekit.Provide[api.Interface]` |
| `Mount(env, mounter)` | mounts the Connect services with `modulekit.Mount` (the only way; `architecturetest` fails on a direct `New*ServiceHandler`) |
| `Retention(env)` | purge policies of its append-only tables (runs before the River client exists) |
| `Remote(env, target)` | binds the unit's network-safe `api/` interfaces to Connect clients for a process that does not host it ([ADR-0020](../../../apps/server/docs/adr/0020-location-transparent-units.md)) |
| `Files`, `Public`, `Roles` | its protobuf files (to validate `AEDST_ROLE_POLICY` against real procedures), procedures reachable without a token, built-in role policy (`admin`: `/aedst.admin.v1.AdminService/*=admin`) |

Modules obtain each other only through `api/` interfaces (`Provide` / `Require`),
so the boundary rules above hold in the composition too. `cmd/server` iterates the
registry (`wire_modules.go`, `wire_jobs.go`, `wire_http.go`) and names no module;
`modules.go` holds one blank import per module. Workers, consumers, retention,
mounts and role policy are the same as the hand-written wiring this replaced, which
the end-to-end integration tests (`cmd/server/main_integration_test.go`) exercise.

`Env.ReadPool` is the primary pool unless `AEDST_DATABASE_READ_URL` is set; only
modules with lag-tolerant reads (search today) use it
([Postgres scaling runbook](/server/runbook-postgres-scaling)).

## Error architecture

Domain and application code return `internal/shared/errors` values: a `Kind`
(`NotFound`, `AlreadyExists`, `Conflict`, `Validation`, `Unauthorized`, `Forbidden`,
`RateLimited`, `FailedPrecondition`, `Unavailable`, `Timeout`) with a client-safe message and a
wrapped cause that never leaves the process. Infrastructure failures go through `sharederrors.Wrap`,
which classifies them: a deadline, network timeout or SQLSTATE `57014` becomes `Timeout`; a refused
or reset connection, an unexpected EOF, SQLSTATE class `08` or `53300`/`57P01-57P03` becomes
`Unavailable`; anything else stays `Unknown` (a bug).

`httpserver.ToConnectError` maps the kinds to ConnectRPC codes: `NotFound`->NOT_FOUND,
`AlreadyExists`->ALREADY_EXISTS, `Conflict`->ABORTED, `Validation`->INVALID_ARGUMENT,
`Unauthorized`->UNAUTHENTICATED, `Forbidden`->PERMISSION_DENIED, `RateLimited`->RESOURCE_EXHAUSTED,
`FailedPrecondition`->FAILED_PRECONDITION, `Unavailable`->UNAVAILABLE (with `Retry-After: 5`),
`Timeout`->DEADLINE_EXCEEDED, anything else->INTERNAL with a generic message. The real cause is logged
and recorded on the span by `ErrorLogInterceptor` (warn for UNAVAILABLE and DEADLINE_EXCEEDED, error for
INTERNAL), so a database outage shows up as a retryable 503-class response and a warning, not as a
stream of "internal error" pages. Handlers do not log-and-return.

## Observability

OpenTelemetry only. `internal/platform/observability` builds the logger, tracer and meter providers;
every `slog` record carries `trace_id`/`span_id` from the request context plus `request_id` and
`user_id` when known, so a log line links to its trace. Metrics are exported by OTLP and, when
`AEDST_METRICS_ADDR` is set, on a Prometheus `/metrics` endpoint (the same OpenTelemetry instruments,
not a second instrumentation library). Resource identity: `service.name` is `AEDST_SERVICE_NAME`
(`<name>-worker-<group>` for a worker Deployment) and `service.instance.id` is the pod name. Alerts and
the dashboard live in the Helm chart (`files/alerts.rules.yaml`, `files/aedst-server-dashboard.json`);
each alert links to the [runbook](/server/runbook).

## Scaling

Everything stays in the one deployable until a measured trigger fires.
**Media** is in-process: bytes go straight to object storage through presigned URLs
and its heavy processing runs on its own River queue (`media`), so a worker
deployment can scale it separately from the same binary. **Realtime** (long-lived
connections) is not implemented; its proposed design is in
[ADR-0008](/decisions/0008-realtime-and-media-extraction). What to measure, the alert
thresholds, connection-pool budgeting, load-test procedure and known limits are
in the [scaling guide](/server/scaling); caching and partitioning strategy is in
[ADR-0010](/decisions/0010-caching-and-data-partitioning); client compatibility
in [ADR-0009](/decisions/0009-api-compatibility-and-client-versioning).
