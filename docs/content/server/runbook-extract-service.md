---
title: "Runbook: extracting a module into its own service"
description: "Ordered steps and the blockers that exist today for turning a module into a separate deployable, or running it as N instances."
---

# Runbook: extracting a module into its own service

The server is a modular monolith ([ADR-0001](/decisions/0001-modular-monolith)): one binary, one
River, modules that only meet through `api/` packages and events. This page is the
ordered path from "a module runs inside the monolith" to "a module runs as its own
deployable". **Take a step only when its trigger fires** ([scaling](/server/scaling#extraction-and-split-triggers));
steps 1-3 need no code and are already supported. The later steps list what is
missing today, and which of those are open owner decisions.

Two different goals, with different costs:

| Goal | What it needs | Status |
|---|---|---|
| **N instances of the same binary** (API replicas, a media worker) | steps 1-2 | supported, shipped in the Helm chart |
| **A separate service** for one module (own deploy, own database, own team) | steps 1-9 | steps 1-8 are built (integration-untested, see the notes); 9 is the cut-over |

## Step 1 - run queues apart (supported)

`AEDST_JOBS_QUEUES` chooses the River queues a process works; the Helm `jobs.queues`
value sets it for the API and each `workers:` entry renders its own Deployment
(same image, ConfigMap and Secret; no Service, no migration hook).
`values-prod.yaml` runs the API on `default=50` and a `media=4` worker. An empty
value makes a process insert-only (verified by
`cmd/server/topology_integration_test.go`: the API commits the event, another process
delivers it, with and without LISTEN/NOTIFY). Every process still registers every
worker, because River validates job kinds on insert.

**Consumer-only worker (done):** event deliveries run on one queue per consumer unit,
`events_<unit>`, and a process works `default` plus the event queue of every unit it
hosts (`AEDST_JOBS_EVENT_WORKERS` per queue; `events_<unit>=n` in `AEDST_JOBS_QUEUES`
overrides). A worker with `AEDST_MODULES=notifications` and `AEDST_JOBS_QUEUES=default=5`
therefore works only `events_notifications` deliveries, while a producer process that
does not host notifications still inserts them, because every unit's static
`Module.Consumes` is registered as a remote consumer. See
[Events](/server/events#event-queues-and-partial-hosting) and the addendum of
[ADR-0014](/decisions/0014-river-insert-tx-as-outbox). The topology integration test
(`cmd/server/topology_integration_test.go`, needs Docker) pins the queue of a delivery.

## Step 2 - run more instances (supported)

Replicas are interchangeable: state lives in Postgres, River's leader election and
unique jobs make periodic work single-instance, rate limits are shared through DragonflyDB.
Size pools with the arithmetic in the scaling guide (`replicas x (maxConns + jobsMaxConns)`
under `max_connections`; the chart refuses a render that exceeds
`database.serverMaxConnections`). Telemetry identity is per pod:
`service.instance.id` comes from the Downward API pod name and a worker's
`service.name` is `<AEDST_SERVICE_NAME>-worker-<name>`.

## Step 3 - route by service prefix (supported)

Connect procedures are plain paths (`/aedst.tasks.v1.TasksService/CreateTask`). The chart's
opt-in `httpRoute` (Gateway API) sends a `servicePrefix` to another backend and everything
else to the monolith, so clients keep one URL. `config.trustedProxyHops` must count
the gateway hop. Set `httpRoute.routes` only after step 6 has produced the second
deployable.

## Step 4 - give the module its own database (supported for integrity, appattest, search)

Modules ask for `env.PoolFor("<module>")` / `env.JobsPoolFor("<module>")`;
`AEDST_DATABASE_URL_<MODULE>` (and `_JOBS` for the direct connection) points the module
at its own database, and an unknown module name fails startup. Apply the module's migrations to
that database (add it to a separate migration Job; the chart's list is per release),
create `pg_trgm` or other extensions it uses, and move its tables (`pg_dump` of the
schema, then drop it from the old database in a later release). **Every unit** now asks for its pools, River client and publisher by name
(`PoolFor`, `JobsPoolFor`, `JobsFor`, `PublisherFor`), so `tasks`, `notifications`,
`media` and `admin` move the same way. `cmd/server` builds one extra River client per
module database (same workers and queues, no periodic jobs) and migrates or verifies the
River schema there, so the jobs and events a module inserts in its own transactions are
worked ([ADR-0022](../../../apps/server/docs/adr/0022-event-forwarding-and-service-identity.md)). Apply the
module's migrations **and** the `platform` migrations (idempotency keys) to its database.
`admin` takes the audit-first path (step 8) for a unit on another database even when that
unit is hosted in the same process.

## Step 5 - events across the boundary (delivery routing done; wire contract open)

Today an event is a River job inserted in the producer's transaction with the payload as
JSON of a Go struct in the producer's `api/` package.

**Done - routing between processes that share the database.** Each unit declares what it
subscribes to (`Module.Consumes`), a process that does not host a unit catalogues those
consumers as remote (`Registry.SubscribeRemote`), and a delivery runs on its consumer
unit's queue `events_<unit>`. So with `AEDST_MODULES` a producer process still inserts
every consumer's delivery in its own transaction and the consumer's process delivers it,
with no broker. This is the whole story as long as the units share one Postgres (the
River tables live in the producer's database).

**Done - crossing a database.** A consumer in another service with its own database is
named in `AEDST_EVENTS_FORWARD` (`unit=https://service`). The producer inserts a
`platform.event_forward` job, in the same transaction as the state change (River stays the
outbox; no dual write), and its worker calls the consumer service's
`aedst.events.v1.EventIngestService/Deliver` with the service identity's token. That service
(`AEDST_EVENTS_INGEST_ENABLED=true`, role `internal` only) inserts the real delivery in its own
database, unique on (consumer, event id), so retries never duplicate. The payload stays the JSON
the producing module serialises (pinned by the golden fixtures); `buf breaking` guards the
envelope in `events.proto`. Permanent rejections cancel the forward visibly; the rest retries.
Alert on `aedst_events_forward_discarded_total`. No broker was added.

## Step 6 - host a subset of units (supported)

There is no second binary to build: `cmd/server` names no module and the same image runs any subset.
`AEDST_MODULES=media` hosts only `media` (a module name also hosts its features, a feature name such as
`social/like` only itself); empty hosts everything. `modulekit.Select` validates the choice at startup: an unknown
unit, or a hosted unit that requires one that is neither hosted nor given a URL, fails with the variable to set
(`AEDST_MODULE_<NAME>_URL`). Helm: `modules.enabled` for the release, `workers[].modules` per worker
Deployment. A unit that is not hosted is not mounted and has no workers or consumers here, so it must be
hosted by exactly one other deployment before you route traffic away from the monolith.

## Step 7 - calls between the services (supported for units with a `Remote` hook)

A required unit that is not hosted is bound by its own `Module.Remote` hook: the same `api/` interface,
implemented over its Connect client (`modulekit.NewClient`: deadline, circuit breaker, rate limit, tracing; the
caller's bearer token is forwarded; remote errors come back as the usual `sharederrors` kinds). The module code
that calls it does not change. Today `tasks` declares one for the `Ownership` contract (used by `media`), held
to a shared contract suite against the in-process implementation (`tasks/api/ownershiptest`). To make another
unit relocatable: narrow its contract to what callers need, keep it network-safe
(`architecturetest.TestRemoteHooksProvideNetworkSafeContracts`), write the adapter in its `module/` package,
and add the same contract suite. Units with a network surface declare a hook: `tasks` (`Ownership`) and `media`
(`Stats`, over `MediaOperatorService`). `notifications` declares a marker hook: what others ask of it (the
operator surface) is consumed by `admin`, which builds that client itself. A call with no user uses the service
identity (`AEDST_SERVICE_IDENTITY_*`, [ADR-0022](../../../apps/server/docs/adr/0022-event-forwarding-and-service-identity.md)); without
it a remote adapter still refuses the call instead of sending it unauthenticated.

## Step 8 - admin without a shared transaction

`admin` is the one module allowed to call other modules' `*Tx` methods in a shared
transaction. That cannot survive a process boundary, so admin chooses per module at
startup (`admin/module/module.go`):

| The target module is | Reads | Mutations |
|---|---|---|
| hosted in this process (default, the monolith) | in-process `api/` | **unchanged**: the module's `*Tx` method runs in the audit entry's own transaction |
| hosted elsewhere (`AEDST_MODULE_<NAME>_URL`) | the owner's operator service, forwarding the operator's own bearer token | **audit-first** |

**Audit-first flow.** One transaction of admin's own writes the `admin.audit_log` row in
state `pending` and an `admin.apply` River job (unique per entry, 10 attempts). The job
(`admin/jobs`, `application.Applier`) reads the entry, calls the owner's operator RPC with
the **audit entry id as the idempotency key**, then resolves the entry to `applied`
(outcome in `result`) or `failed` (client-safe reason in `failure`). Permanent errors
(`NotFound`, `Validation`, `Conflict`, `FailedPrecondition`) fail the entry at once; transient
ones (`Unavailable`, `Timeout`, authentication or rate-limit errors) retry with River's
backoff and fail the entry on the last attempt, so nothing stays `pending` forever. Because
the owner replays an idempotency key (`tasks.operator` / `notifications.operator`, in the
owner's own transaction), a retry after a lost response never repeats the effect.

**The audit table stays append-only.** Migration `00003_audit_log_pending_state` lets
exactly one UPDATE through the trigger: a `pending` row becomes `applied` or `failed` by
filling `state`, `failure`, `result` and `resolved_at`; every column that says who did what
to what and why (actor, action, target, reason, metadata, `created_at`) must be unchanged.
`sqlc.yaml`'s `audit-log-is-append-only` rule allows only the query `ResolveAuditEntry`,
and only with `state = 'pending'` in its WHERE (negative self-test in `scripts/sqlc-selftest.sh`).

**Owner operator services** (closed by default; `Roles` in `tasks/module/roles.go` and
`notifications/module/roles.go`): `TasksOperatorService` (`ListAllTasks`, `GetAllTaskStats`,
`OperatorDeleteTask`) and `NotificationsOperatorService` (`CountAllActiveDevices`,
`OperatorBroadcast`). Reads admit `admin`/`support`/`auditor` as in admin's own policy;
mutations admit `admin` and `internal`, the role of the service identity.

**Service identity (done).** The job has no request and so no token: it uses an OIDC
client-credentials client (`AEDST_SERVICE_IDENTITY_TOKEN_URL`, `_CLIENT_ID`, `_CLIENT_SECRET`,
`_SCOPES`; `internal/platform/serviceauth`). Create a machine user in the identity provider, grant it
the `internal` role and scopes that make its access token pass this server's audience and roles checks
(ZITADEL: `openid urn:zitadel:iam:org:project:id:<project>:aud urn:zitadel:iam:org:projects:roles`).
Without these settings an operator mutation on a module hosted elsewhere is refused up front
(`FailedPrecondition`, no `pending` row) and reads still work. The same identity signs event forwards (step 5).

**Not covered / limits.** `CountByOwners` has no network surface. The media totals do
(`MediaOperatorService`, step 7). The admin RPC and the clients do not
yet show `pending`/`failed` entries: `aedst.admin.v1.AuditEntry` has no `state` field, and
adding it regenerates the web and Android clients (a separate, additive change).
The audit-first SQL, the trigger change, the job, the service-identity token source, event forwarding
and the per-database River clients were verified by unit tests with fakes, `architecturetest`, lint
and `sqlc vet`; **no integration test has run against Postgres, River or a real IdP** (no Docker where
this was written): run `task check:full` and one real client-credentials call before relying on it.

## Step 9 - deploy and cut over

1. Build and publish the image (the CI image job already pushes `server` and `migrate`).
2. Add the service's Deployment (a second chart or release), its Argo CD Application and its
   migration module list.
3. Deploy with the monolith still serving the module; verify with the new service in
   shadow (its HTTPRoute rule is absent).
4. Add the `httpRoute.routes` entry; watch error rate, latency and `aedst_river_oldest_available_age_seconds`.
5. Remove the module from the monolith's enabled set (needs decision C2) in a later release.

Rollback until step 4 of cut-over is deleting the route entry.
