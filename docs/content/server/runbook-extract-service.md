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
| **A separate service** for one module (own deploy, own database, own team) | steps 1-9 | steps 1-4 and 6-7 are seams that exist; 5, 8, 9 are blockers (below) |

## Step 1 - run queues apart (supported)

`AEDST_JOBS_QUEUES` chooses the River queues a process works; the Helm `jobs.queues`
value sets it for the API and each `workers:` entry renders its own Deployment
(same image, ConfigMap and Secret; no Service, no migration hook).
`values-prod.yaml` runs the API on `default=50` and a `media=4` worker. An empty
value makes a process insert-only (verified by
`cmd/server/topology_integration_test.go`: the API commits the event, another process
delivers it, with and without LISTEN/NOTIFY). Every process still registers every
worker, because River validates job kinds on insert.

**Blocker for a consumer-only worker (decision C1, open):** event deliveries are all on
the `default` queue, so a worker cannot own only one module's consumers. That needs the
`events.<module>` queues and a subscription catalog separate from the handler map; it
contradicts ADR-0001's "only for a measured reason" until the owner decides.

## Step 2 - run more instances (supported)

Replicas are interchangeable: state lives in Postgres, River's leader election and
unique jobs make periodic work single-instance, rate limits are shared through Valkey.
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

## Step 4 - give the module its own database (supported for integrity, appattest)

Modules ask for `env.PoolFor("<module>")` / `env.JobsPoolFor("<module>")`;
`AEDST_DATABASE_URL_<MODULE>` (and `_JOBS` for the direct connection) points the module
at its own database, and an unknown module name fails startup. Apply the module's migrations to
that database (add it to a separate migration Job; the chart's list is per release),
create `pg_trgm` or other extensions it uses, and move its tables (`pg_dump` of the
schema, then drop it from the old database in a later release). **Blockers:** the
other modules (`tasks`, `notifications`, `search`, `media`, `admin`, `auth`) still use
`env.Pool` directly, so converting one means switching its constructors to `PoolFor`
first; a module whose transaction also writes `platform.event_delivery` jobs (River's
table) cannot move: the River tables live in the database of the *publisher*, which is
why step 5 matters.

## Step 5 - events across the boundary (blocked: owner decision B3/C1)

Today an event is a River job inserted in the producer's transaction with the payload as
JSON of a Go struct in the producer's `api/` package. A consumer in another service needs
(a) a wire contract that is not a Go type - `events.proto` per producer, marshalled with
protojson so the JSON on the wire does not change, guarded by `buf breaking` - and (b) a
delivery path out of the producer's database: the River job `platform.event_forward`
(River stays the outbox; a broker adapter, if ever, is a River-delivered consumer, never a
dual write). Until the owner confirms ADR-0014's change, `goldentest` fixtures
(`<module>/api/testdata/*.json`) pin the wire format.

## Step 6 - a second binary

`cmd/server` names no module; the module registry builds the process. A second binary is
a new `cmd/<service>/modules.go` with its own blank imports. **Blocker (decision C2, open):**
`AEDST_MODULES` / a subset registry with `Requires` validation, per-module config
validation, and conditional push/storage clients, plus `registry_test` accepting subsets
there. Without it the new binary would still start every module's config checks.

## Step 7 - calls between the two services

Today a module reaches another through its Go `api/` interface (for example media asks
tasks for ownership through the `TaskOwnership` port). Across a process boundary that call
becomes a Connect client built where the module is wired (`cmd/<service>`), behind the same
port, so the module code does not change. The in-process RPC transport that used to sit in
`platform/rpc` was deleted as dead code (decision of 2026-10-09: it had no caller); write the
client at the first extraction with `platform/resilience` (breaker, timeout, rate limit), an
otelconnect client interceptor, and identity: bearer pass-through for user-scoped calls, a
client-credentials machine token for internal ones, and an `internal` role in the role policy.

## Step 8 - admin (blocked: decision C3)

`admin` is the one module allowed to call other modules' `*Tx` methods in a shared
transaction. It cannot after extraction. The audit-first design (an `admin.audit_log` row in
`pending` state plus a River job `admin.apply` that calls the owning module's API with the
audit id as idempotency key) replaces the shared transaction; the in-process `Tx` stays the
default until a module is extracted.

## Step 9 - deploy and cut over

1. Build and publish the image (the CI image job already pushes `server` and `migrate`).
2. Add the service's Deployment (a second chart or release), its Argo CD Application and its
   migration module list.
3. Deploy with the monolith still serving the module; verify with the new service in
   shadow (its HTTPRoute rule is absent).
4. Add the `httpRoute.routes` entry; watch error rate, latency and `aedst_river_oldest_available_age_seconds`.
5. Remove the module from the monolith's enabled set (needs decision C2) in a later release.

Rollback until step 4 of cut-over is deleting the route entry.
