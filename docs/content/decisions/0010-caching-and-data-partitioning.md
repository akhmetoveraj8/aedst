---
title: "ADR-0010: Caching and Data Partitioning"
description: "Accepted. Nothing in this ADR is implemented yet; it fixes the rules and the order of escalation so that today's schema and code do not block them."
---

# ADR-0010: Caching and Data Partitioning

## Status
Accepted. Nothing in this ADR is implemented yet; it fixes the rules and the order
of escalation so that today's schema and code do not block them.

## Context
The system is a modular monolith on one PostgreSQL primary
([ADR-0001](/decisions/0001-modular-monolith), [ADR-0003](/decisions/0003-postgresql)).
Scaling reads and data volume will eventually need caching and partitioning. Doing
either early adds invalidation bugs and operational cost; doing it late is only
possible if the data model already carries the right keys.

## Decision

### Caching (when measured)
**Trigger:** a measured p95 of a specific read path, or database CPU, exceeds its
budget and cannot be fixed by an index or query change. Until then, do not cache.

Rules when a cache is introduced:
- **Valkey cache-aside** only, and only for read-heavy data that tolerates
  staleness. Never write-through, never a source of truth.
- Keys are namespaced `aedst:<module>:<entity>:<id>:v<schemaVersion>`; bumping
  `schemaVersion` invalidates all entries after a shape change.
- **A TTL is always set, with jitter** (for example TTL +/- 10-20%) so entries do
  not expire together.
- **Stampede protection** with `singleflight` (`golang.org/x/sync/singleflight`)
  around the loader.
- **Invalidation is done by the owning module** from its own domain events (River-delivered, ADR-0014);
  a module never invalidates or reads another module's keys or tables.
- **Never cache authorization decisions** (permissions, ownership checks, token
  validity).
- **HTTP caching** (`ETag`, `Cache-Control`) at Cloudflare for public read endpoints
  only; authenticated responses are `private, no-store` unless proven safe.

### Partitioning and sharding
`user_id` (UUIDv7) is the **tenant/shard key**:
- Every table holding user data carries `user_id`, and its indexes have `user_id`
  as the **leading column**.
- No cross-user joins in hot paths.
- UUIDv7 ids are time-ordered, which keeps b-tree inserts append-mostly and
  index-efficient.

Escalation roadmap, each step taken only when a single primary is measured to be
insufficient for the previous one:
1. **Native declarative partitioning** in PostgreSQL: hash by `user_id`, or range by
   time for append-only tables (messages, notifications), managed with
   `pg_partman`. This also makes retention a partition drop.
2. **Read replicas** for read-mostly modules (routing at the repository layer, with
   replication lag tolerated only where the module declares it).
3. **Module-per-database**: already prepared, because each module owns its own
   schema and never joins across schemas
   ([database.md](/server/database), [ADR-0006](/decisions/0006-module-boundaries)).
4. **Citus or application-level shard routing** by `user_id`, only when one primary
   per module is proven insufficient.

**Multi-tenancy (B2B organisations) is explicitly out of scope** until the product
needs it. If it does, `tenant_id` becomes a new leading column of the affected
indexes and partition keys; this ADR is then superseded for those tables.

## Consequences
- No cache or partitioning cost is paid before it is justified by a measurement.
- The `user_id`-first rule is a modelling constraint on every new table today; a
  migration review must reject user-owned tables without it.
- Cache correctness depends on each module publishing complete domain events; missing
  events mean stale data until TTL.
- Cross-user features (feeds, global search, leaderboards) cannot rely on hot-path
  joins and will need denormalised read models or a dedicated store.
- Each roadmap step is a separate decision with its own ADR when triggered.
