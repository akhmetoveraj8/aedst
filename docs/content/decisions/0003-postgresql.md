---
title: "ADR-0003: PostgreSQL as the system of record, no ORM"
description: "Accepted"
---

# ADR-0003: PostgreSQL as the system of record, no ORM

## Status
Accepted

## Context
The system needs a relational store with strong consistency guarantees, mature
tooling, and a clear path to per-module/per-service database ownership as
modules are extracted.

## Decision
PostgreSQL 18 is the source of truth for every module. Access is through
`pgx v5` (driver/pool) and `sqlc` (typed query generation from hand-written
SQL) — no ORM. Migrations are managed with Goose, namespaced per module.
Connection pooling in front of the app (for horizontal scaling) is PgBouncer in
transaction mode. Schema-per-module from Phase 1 (see
[database.md](/server/database)).

## Consequences
- SQL stays explicit and reviewable; no hidden N+1 queries or magic query
  generation to debug.
- `sqlc generate` output in `gen/` is never hand-edited; CI verifies it's up to
  date with the `sql/` sources.
- Schema-per-module means extracting a module's database later is a
  `pg_dump --schema=<module>` + restore, not a data-migration project.
- Losing ORM conveniences (eager loading, migrations-from-models) is accepted:
  migrations and queries are both hand-written, which is more verbose but keeps
  every query's cost visible and every schema change intentional.
