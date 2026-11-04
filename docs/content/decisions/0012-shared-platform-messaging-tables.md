---
title: "ADR-0012: Shared platform tables for outbox, inbox and idempotency"
description: "Partly superseded by ADR-0014: platform.outbox and platform.inbox were dropped (River InsertTx is the outbox, handlers are idempotent),..."
---

# ADR-0012: Shared platform tables for outbox, inbox and idempotency

## Status

Partly superseded by [ADR-0014](/decisions/0014-river-insert-tx-as-outbox): `platform.outbox` and `platform.inbox` were dropped (River `InsertTx` is the outbox, handlers are idempotent), `platform.idempotency_keys` remains as described. Originally: refined [ADR-0011](/decisions/0011-outbox-relay-and-in-process-bus) and the "one schema per module" rule in [database.md](/server/database): module *business* tables stay in the module's schema; the three messaging/deduplication tables are platform-owned.

## Context

Every module that produced events, consumed events or accepted idempotency keys needed its own copy of the same three tables, the same SQL (`outbox.sql`, `inbox.sql`, `idempotency.sql`) and the same ~250 lines of repository code, and a sqlc regeneration per module. The copies drifted: idempotency keys were global rather than per caller, none of the tables had retention, and the inbox was keyed by event id only, so two consumers of one event in one module could not dedupe independently.

## Decision

`migrations/platform` owns three tables in the `platform` schema:

| Table | Key | Discriminator |
|---|---|---|
| `platform.outbox` | `event_id` | `module` — each relay claims only its module's rows |
| `platform.inbox` | `(consumer, event_id)` | the consumer name, e.g. `notifications.task_completed` |
| `platform.idempotency_keys` | `(scope, key)` | scope = module + caller, e.g. `tasks:<user id>` |

`internal/platform/{outbox,inbox,idempotency}` ship the PostgreSQL implementations (plain `pgx`, no per-module sqlc). A module writes `outbox.NewPostgresRepository(pool, "<module>")` in `cmd/server` and nothing else; a consumer is `inbox.NewConsumer(name, pool, handler, logger)`; idempotency is `idempotency.Check/Save` with a scope.

The rows still commit in the **same transaction** as the module's domain write (one database), so the transactional guarantees of ADR-0011 are unchanged. Migration order is `platform` first, then modules (`task migrate`, the Helm migration Job and `postgrestest` all do this).

## Consequences

- A new module needs **no** outbox/inbox/idempotency tables, SQL or repository code. `TestEveryModuleHasAPIAndMigrations` and `TestModuleBoundaries` keep the module template honest.
- Retention is one place: `platform.inbox` and `platform.idempotency_keys` are purged by River periodic jobs (`internal/platform/retention`), the outbox by its relay.
- Idempotency keys are namespaced per caller and serialized with a transaction-scoped advisory lock, so concurrent same-key requests execute once and users cannot probe each other's keys.
- Extracting a module into its own service moves its rows with `WHERE module = …` / `WHERE consumer LIKE '<module>.%'` / `WHERE scope LIKE '<module>:%'`; if it gets its own database it gets its own copy of the `platform` migration.
- The three tables are shared write targets: a hot module's outbox churn shares a table (and autovacuum) with the others. Partial indexes lead with `module`, so the claim query stays an index probe; revisit (partition by `module`, or a per-module table again) if `pg_stat_user_tables` shows the shared outbox as a vacuum or bloat hotspot.

## Revisit when

Outbox write rate of one module is high enough to dominate `platform.outbox` maintenance, or a module is extracted with its own database (then it takes its rows and its copy of the migration).
