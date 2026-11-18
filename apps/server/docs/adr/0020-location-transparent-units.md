# ADR-0020: Location-transparent units (module and feature services from one codebase)

- Status: Accepted (2026-11-18). Refines [ADR-0001](../../../../docs/content/decisions/0001-modular-monolith.md)
  (monolith first) and [ADR-0006](../../../../docs/content/decisions/0006-module-boundaries.md); it
  implements the "extraction path" of `docs/content/server/architecture.md` as configuration instead of a
  rewrite. Decides the open items B3 (events across processes, without protobuf event contracts), C1, C2 and C3 of `docs/proposals/owner-decisions-2026-10.md`.
- Scope: `apps/server`.

## Context

The goal is a backend that is written once and can be deployed in three shapes without rewriting code:

1. **Modular monolith**: one process, every unit inside it (today's default).
2. **Module services**: a large module (`chat`, `profile`, `tasks`) runs as its own process.
3. **Feature services**: a small capability inside a module (`social/like`, `social/comment`, `shop/cart`)
   runs as its own process.

The boundaries, the module registry, `events.Publisher`, database-per-module pools and the per-process
queue split already existed. Four things were missing, all recorded as blockers in
`runbook-extract-service.md`: a way to choose which units a process hosts (C2), a way to call a unit that is
not hosted (step 7), delivery of events to consumers that live in another process (B3/C1) and an admin
module that does not need other modules' transactions (C3). There was also no level below "module".

## Decision

### 1. One concept: the unit

A **unit** is a module (`chat`) or a feature of a module (`social/like`). Every unit has the same shape:

| Part | Rule |
|---|---|
| Contract | `api/` (Go interfaces) backed by a proto service; the only thing another unit may import |
| Data | its own Postgres schema (`<module>` or `<module>_<feature>`), no SQL against another schema |
| Events | publishes and consumes only through `events.Publisher` / the registry |
| Registration | `module/` calls `modulekit.Register` with `Name` = `chat` or `social/like` |

A module groups features: `internal/modules/<m>/features/<f>/{api,application,domain,infrastructure,transport,module}`.
Units of one module meet exactly like units of different modules, through `api/`; a feature never imports the
module that groups it; the module composes its features' `api/` (and may re-export them as its own `api/`).
Migrations and queries of a feature live in `migrations/<m>_<f>` and `sql/<m>_<f>`.

### 2. Topology is configuration

`AEDST_MODULES` (comma list, empty = everything) selects the hosted units; a module name enables its
features, a feature name only itself. `AEDST_MODULE_<NAME>_URL` (`/` written `__`) is where a unit that is
not hosted lives. `modulekit.Select` resolves them: a hosted unit that `Requires` a unit neither hosted nor
given a URL fails startup naming the missing variable. The same binary, with different environment, is the
monolith, a module service or a feature service.

### 3. A remote unit is bound by its own `Remote` hook

`Module.Remote(env, target)` runs instead of `Setup` for a required unit that is not hosted, and calls
`modulekit.Provide[api.X]` with a Connect-client implementation of the same interface. Consumers keep calling
`modulekit.Require[api.X]` and cannot tell. The client (`modulekit.NewClient`) has a deadline, a circuit
breaker and a rate limit (`platform/resilience`), is traced (`otelhttp`) and forwards the caller's bearer
token; remote errors are mapped back to `sharederrors` kinds (`modulekit.ErrorFromConnect`), so a caller
handles "not found" the same way in both shapes.

### 4. Contracts that can be relocated are narrow and network-safe

A unit that offers a `Remote` hook promises that what the hook provides is serializable: values in, values
out, `context.Context` first, `error` last; no `pgx.Tx`, channels, functions, readers or unexported-field
structs. A consumer depends on the narrowest interface it needs (`tasks/api.Ownership`, not the whole
`Service`). `architecturetest.TestRemoteHooksProvideNetworkSafeContracts` enforces it by type-checking every
interface a `Remote` hook provides. Every relocatable contract has a shared contract suite run against the
in-process and the Connect implementation (`tasks/api/ownershiptest`), so behaviour cannot diverge.

### 5. Identity across processes

User-scoped synchronous calls forward the caller's own access token (`platformauth.WithBearer`, set by the
auth interceptor after verification); the receiving unit verifies it like any request. A remote adapter
refuses to ask on behalf of a user other than the authenticated one, and a call with no user (a background job)
is refused rather than sent unauthenticated. Service-to-service identity for work with no user is a
client-credentials token with the `internal` role: built in [ADR-0022](0022-event-forwarding-and-service-identity.md)
(`internal/platform/serviceauth`, `AEDST_SERVICE_IDENTITY_*`).

### 6. Event delivery with a partial topology

An event is a River job inserted in the producer's transaction, one per subscribed consumer. With a subset of
units hosted, the producer must still insert deliveries for consumers it does not host, and a process must
not pick up deliveries it cannot handle. So:

- every unit declares its subscriptions statically (`Module.Consumes`; `architecturetest` compares them with
  the `Subscribe` calls in `infrastructure/events`), and `cmd/server` registers the consumers of every unit it
  does not host as catalog-only entries (`Registry.SubscribeRemote`);
- a delivery goes to the queue `events_<unit>` (the part of the consumer name before the first `.`, `/`
  written `_`; River queue names cannot contain a dot). A process works `events_<unit>` for each unit it hosts
  that subscribes, when it works `default` (`AEDST_JOBS_EVENT_WORKERS` per queue), so the monolith behaves as
  before and a `media=4` worker does not consume events;
- a delivery that reaches a process without a handler fails and retries instead of completing silently.

Consumers may move to their own database independently (`PoolFor`/`JobsPoolFor`; `search` does). A producer
cannot while its events live in the shared River tables: forwarding between databases
(`platform.event_forward`) is built in [ADR-0022](0022-event-forwarding-and-service-identity.md) and no broker was added.

### 7. Operator actions across processes

`admin` keeps the in-process `*Tx` path as the default when the owning unit is hosted here. When it is not,
admin writes an `admin.audit_log` row in state `pending` and an `admin.apply` River job in one transaction; the
job calls the owner's operator RPC (`TasksOperatorService`, `NotificationsOperatorService`, closed by default,
idempotent on the audit entry id) and resolves the row to `applied` or `failed`. The operator services live in
the owning units' protos because `admin` serves `aedst.admin.v1` itself. The audit table stays append-only
except for that one transition. The job has no user token, so it uses the machine
identity of ADR-0022 (client-credentials client plus an `internal` role); without `AEDST_SERVICE_IDENTITY_*` a
remote mutation is still refused with `FailedPrecondition` before any row is written, while reads forward the
operator's own token.

### 8. Gates

`architecturetest` fails the build when: a feature imports its module or reaches into a sibling feature other
than through `api/`; a feature lacks `api/`, `module/` or its schema; a unit's SQL or migration references
another unit's schema (`platform.*` exempt); a `Remote` hook provides a contract that cannot cross a process
boundary. Each gate has a negative self-test.

## Consequences

- Splitting a module is configuration plus a database move, not a code change: set `AEDST_MODULES` on the
  new deployment and `AEDST_MODULE_<NAME>_URL` on the others.
- Only units that declare `Remote` can be reached over the network. Today that is `tasks` (the `Ownership`
  contract, used by `media`); the others are consumer-only or composition modules and gain a hook when a
  synchronous caller needs one.
- A call that was a function becomes a network call when a unit moves: latency, partial failure and retries
  appear. Batch methods (`GetMany`) belong in a contract before it is split, not after.
- **Not built, by design (YAGNI until a unit needs it):** a broker, a service mesh, per-unit Helm charts. The seams for each exist; none is a precondition for splitting.
- **Do not split early.** Feature-level services multiply deployments, dashboards and failure modes. The
  structure (units, contracts, schemas) is cheap and is done up front; a process boundary is added only for a
  measured reason (ADR-0001 still holds).

## Revisit when

Two units that must be transactionally consistent are split (add a saga, not a distributed transaction); the
number of remote units makes per-environment URLs unmanageable (adopt service discovery).
