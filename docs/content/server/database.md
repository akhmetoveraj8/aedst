---
title: "Database Ownership"
description: "Phase 1 runs a single PostgreSQL 19 cluster/database, but schema-per-module from day one — this is what makes database-per-module (Phase 2) and..."
---

# Database Ownership

Phase 1 runs a single PostgreSQL 19 cluster/database, but **schema-per-module**
from day one — this is what makes `database-per-module` (Phase 2) and
`database-per-service` (Phase 3) a `pg_dump`/restore exercise instead of a
migration project.

| Schema | Owning module | Notes |
|---|---|---|
| `auth` (retired) | `auth` | no tables: dropped by migration `auth/00004` (ADR-0019); the directory keeps its migrations only so the drop still runs |
| `notifications` | `notifications` | projection of other modules' events (consumer-only); `user_id` has no FK, like `tasks` |
| `tasks` | `tasks` | the reference module — see [modules.md](/server/modules). `tasks.tasks.user_id` has no FK to `auth.credentials`: no module references another module's schema, not even via FK (see below) |
| `search` | `search` | `search.documents`: a projection fed by task events (consumer-only) |
| `media` | `media` | `media.media`, `media.variants`; publishes media events |
| `admin` | `admin` | `admin.audit_log`, written in the same transaction as the operator mutation |
| `appattest` | `appattest` | `appattest.challenges`, `appattest.keys` (device attestation, ADR-0016) |
| `integrity` | `integrity` | `integrity.verified_tokens` (device attestation, ADR-0016) |
| `platform` | none (shared infrastructure) | `platform.idempotency_keys` only (ADR-0012); the former `outbox`/`inbox` tables were dropped (`platform/00002_drop_outbox_inbox.sql`), River's `river_job` is the outbox (ADR-0014). Its migrations run first. `capabilities` has no schema |

Rules (see [ADR-0003](/decisions/0003-postgresql) and
[ADR-0006](/decisions/0006-module-boundaries)):

- No module runs a query that references another module's schema, directly or
  via `JOIN`. This is enforced by the layer rules and `architecturetest`, not by
  database roles: the server uses one database role today. Per-module roles
  (privileges on its own schema only) are a prerequisite for
  database-per-module and do not exist yet.
- Database-per-module is configuration for modules that ask for `env.PoolFor(name)` /
  `env.JobsPoolFor(name)` (integrity and appattest today): `AEDST_DATABASE_URL_<MODULE>` and
  `_JOBS` point the module at its own database; an unknown module name fails startup. The
  module's migrations must then be applied to that database, see the
  [extraction runbook](/server/runbook-extract-service#step-4-give-the-module-its-own-database-supported-for-integrity-appattest).
- Migrations live under `migrations/<module>/` and are namespaced per module so
  they can be split into their own repo/pipeline at extraction time without
  touching other modules' migration history.
- `sql/<module>/*.sql` + `sqlc.yaml` generate typed query code into
  `gen/<module>/db`; only `infrastructure/postgres` in that module imports it.
- No ORM. Explicit SQL, explicit transactions (`platform/database` provides a
  `WithTx` helper), explicit indexes/constraints/foreign keys — enforced within
  a schema, never across schemas.
- Connections are pooled through pgx internally and (in front of the server
  process, for horizontal scaling) through PgBouncer in transaction mode.

## Cross-module data

When a module needs data owned by another module:

1. Prefer calling the owning module's `api/` package (in-process today, RPC
   after extraction).
2. If that becomes a hot path or the caller needs to query/filter/sort on the
   foreign data, build a local read-model/projection populated by consuming the
   owning module's domain events (see [events.md](/server/events)) — e.g. the `notifications`
   and `search` modules keep such projections, fed by the `tasks.v1.*` events
   that `tasks` publishes (`media` publishes its own `media.v1.*` events),
   instead of joining into `tasks.*`. Reference: `internal/modules/notifications`.

Both patterns survive the module being moved to a separate database; a
cross-schema `JOIN` does not.

## Connection pools and PgBouncer

The server holds **two pgx pools**:

| Pool | Env | Used by |
|---|---|---|
| `api` | `AEDST_DATABASE_URL`, `AEDST_DATABASE_MAX_CONNS` (20) | request handlers |
| `jobs` | `AEDST_DATABASE_DIRECT_DSN` (falls back to the main URL), `AEDST_DATABASE_JOBS_MAX_CONNS` (30) | River, event consumers (delivery jobs) |

They are separate so a burst of background work can only exhaust its own
connections, never the ones requests need, and a request storm cannot starve
event delivery. Budget: `replicas × (MAX_CONNS + JOBS_MAX_CONNS)` must stay
below Postgres `max_connections` (or PgBouncer's server pool). Both pools
export `aedst_db_pool_*` metrics; alert when `acquired == max` for the `api`
pool or when `aedst_db_pool_empty_acquire_total` keeps rising.

In front of Postgres, run PgBouncer in **transaction mode** for the `api` pool,
set `AEDST_DATABASE_POOLER=pgbouncer` (pgx is then forced onto
`QueryExecModeCacheDescribe`; startup fails unless `AEDST_DATABASE_DIRECT_DSN` or
`AEDST_JOBS_POLL_ONLY=true` is set) and point `AEDST_DATABASE_DIRECT_DSN` at
Postgres itself: River uses `LISTEN/NOTIFY` and session-level advisory locks
(`lock.Locker`, constructible only from a `database.DirectPool`) do not survive
transaction pooling; only `pg_advisory_xact_lock` is safe through the pooler.
On Kubernetes the pooler is the CloudNativePG `Pooler`; the standalone image is
Docker Compose only. See [deployment.md](/server/deployment#pgbouncer-and-the-database)
and [scaling.md](/server/scaling#pooler-sizing-replicas-vs-pgbouncer).

## Querying rules that keep tables scalable

- **Every owner-scoped table leads its indexes with `user_id`** — the tenant and
  future shard key ([ADR-0010](/decisions/0010-caching-and-data-partitioning)).
- **Keyset pagination, never `OFFSET`**, for any collection that can grow:
  `WHERE (sort_key, id) < ($cursor_key, $cursor_id) ORDER BY sort_key DESC, id
  DESC LIMIT n+1`, backed by an index whose columns all share that direction
  (`(user_id, created_at, id)`). See `internal/shared/pagination`. The response
  carries an opaque `next_page_token`; a total count is computed only for the
  first page, because `count(*)` over the matching set is the same O(rows) cost
  keyset pagination exists to avoid.
- **Substring search uses `pg_trgm`** GIN indexes (`ILIKE '%term%'` cannot use a
  b-tree). LIKE metacharacters in user input are escaped so `%` and `_` match
  literally. Ranked/relevance search belongs in the `search` module, not in a
  business table's query.
- **Indexes on populated tables are created `CONCURRENTLY`** in a
  `-- +goose no transaction` migration; `squawk` (`task lint:migrations`)
  enforces it.
- **Integration events are River jobs** ([ADR-0014](/decisions/0014-river-insert-tx-as-outbox)):
  a producer inserts the delivery jobs in its own transaction, so `river_job` is the
  outbox and no module (or platform) outbox/inbox table exists. The only
  platform-owned table left is `platform.idempotency_keys` ([ADR-0012](/decisions/0012-shared-platform-messaging-tables),
  keyed by `scope`); `migrations/platform/00002` dropped `platform.outbox` and `platform.inbox`.
  `platform` is migrated **first** (`task migrate`, the Helm Job, `postgrestest`).
- **Every append-only table has a retention policy**: finished River jobs (event
  deliveries included) are cleaned by River (`AEDST_JOBS_*_RETENTION_HOURS`);
  idempotency keys and dead sessions are
  purged by River periodic jobs (`internal/platform/retention`,
  `AEDST_RETENTION_*`). A new append-only table ships with its `retention.Policy`
  and a supporting index on the timestamp it purges by. Tables that outgrow
  batched deletes (notifications, later messages, `river_job` under event load) are the first candidates
  for declarative partitioning.
- **Optimistic concurrency** where users edit shared state: a `version` column
  bumped by every mutation, and an optional `expected_version` on the update RPC
  (`ABORTED` when stale). Updates are single statements (`COALESCE`d columns), not
  read-modify-write, so concurrent edits of different fields never overwrite each
  other. Migrations run with `PGOPTIONS="-c lock_timeout=5s"` so DDL fails fast
  rather than queueing behind traffic.
