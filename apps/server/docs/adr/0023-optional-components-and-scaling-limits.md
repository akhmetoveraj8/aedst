# ADR-0023: Optional components, enablement criteria and scaling limits

- Status: Accepted (2026-11-21). Adds criteria to [ADR-0001](../../../../docs/content/decisions/0001-modular-monolith.md),
  [ADR-0014](../../../../docs/content/decisions/0014-river-insert-tx-as-outbox.md),
  [ADR-0020](0020-location-transparent-units.md) and [ADR-0021](0021-nats-jetstream-and-rust-gateway.md).
  It removes nothing and reverses nothing; it says when each optional part is switched on.
- Scope: `apps/server`.

## Context

An architecture review of 2026-11-21 found that the server runs, or can run, many moving parts for a
small codebase: PostgreSQL, River, DragonflyDB, Meilisearch, flagd, NATS JetStream, the Rust gateway,
imgproxy, the identity provider, and the unit topology (`AEDST_MODULES`). Every part is a failure domain
and an operational cost. The review also listed limits that are easy to misread as TODOs.

The parts are already optional in configuration, so the question is only when to enable them:

| Part | Off by | Fallback when off |
|---|---|---|
| NATS JetStream bridge | `AEDST_NATS_URL` empty | no realtime push; River consumers are unaffected |
| Meilisearch | `AEDST_SEARCH_URL` empty (`search.Disabled`) | `pg_trgm` substring search |
| DragonflyDB | no cache URL | cache fails open; rate limits degrade to per-replica in-process limits; `/readyz` reports `degraded` |
| Unit topology | `AEDST_MODULES` unset | one process hosts every module |
| Read pool | `AEDST_DATABASE_READ_URL` unset | reads use the primary |

## Decision

### 1. Enablement criteria (default is off)

| Part | Enable when (all of the listed evidence exists) | Do not enable because |
|---|---|---|
| NATS + Rust gateway | A shipped client feature needs server push with sub-second latency (live task updates, presence), and polling at an acceptable interval was measured to be insufficient | "realtime will be needed" |
| Meilisearch (stays the one search engine, owner decision of 2026-11-18; only the moment of deploying it is decided here) | Ranked or typo-tolerant search is a product requirement, or `pg_trgm` p95 on the real dataset exceeds the search SLO (`aedst_db_slow_queries`, traces) | search exists as a module |
| Module extraction (`AEDST_MODULES`) | A trigger row of `docs/content/server/scaling.md` held for the stated period after tuning, and `runbook-extract-service.md` has been rehearsed in staging | the code allows it |
| Read replica | Primary CPU above 60 % sustained with read statements dominating `pg_stat_statements`, **and** the replica run below was done | a pool setting exists |

Enabling a part is a configuration change plus an entry in the deployment's values; it does not need a
new ADR unless it changes a rule in `AGENTS.md`. Disabling one that is on is allowed at any time because
each has the fallback above. The code stays: removing it is a separate decision for the owner.

### 2. `idempotency_keys` is deliberately not partitioned

PostgreSQL requires every unique constraint on a partitioned table to include the partition key. The
guarantee of `platform.idempotency_keys` is global uniqueness of `(scope, key)`; partitioning by
`created_at` would make the primary key `(scope, key, created_at)`, so the database would no longer reject
a second row for the same key in another time bucket, and `ON CONFLICT (scope, key)` would stop working.
Hash partitioning on `scope` keeps the constraint but does not make old data droppable, which is the only
reason to partition. The table stays unpartitioned; retention purges it in bounded batches
(`PurgeIdempotencyKeys`, `LIMIT`), indexed by `created_at`.

Revisit when the batched purge shows up in `pg_stat_statements` above 5 % of primary CPU or the table
exceeds 100 GB. Then prefer moving idempotency to its own database over partitioning it.

### 3. `river_job` is not ours to partition

River owns the table and its migrations. The escape hatches stay the ones in ADR-0014: a dedicated queue for
event deliveries, more worker replicas, then a separate River database for deliveries. None is built; the
trigger is the `AedstJobsLagging` / `AedstJobsBacklogGrowing` alerts holding after `AEDST_JOBS_QUEUES` and
`AEDST_DATABASE_JOBS_MAX_CONNS` were raised (`default=10` delivered about 85 jobs/s, `default=50` about
370 jobs/s on the development baseline).

### 4. Facts the review confirmed, so they are not re-opened

- Alerts for event loss and lag exist and are unit-tested: `AedstEventDiscarded` (any increase of
  `aedst_events_discarded_total`), `AedstJobsLagging` (`aedst_river_oldest_available_age_seconds` above 30 s
  for 5 min), `AedstJobsBacklogGrowing`, `AedstEventDeliveryFailing`
  (`deployments/helm/aedst-server/files/alerts.rules.yaml`).
- Both admin paths (in-process `*Tx` and the pending audit entry plus `admin.apply` job) have unit tests
  (`internal/modules/admin/application/service_test.go`, `audit_first_test.go`).
- The "no inbox table" rule of ADR-0012 stands. Consumer idempotency stays the consumer's duty
  (`UNIQUE source_event_id` or a version-guarded upsert), checked in review.

### 5. What is still unproven (stays in `scaling.md`, "Known limits")

No production-shaped load run, no run of `task loadtest:pgbouncer`, no read replica run, no rendered Helm
chart against a cluster. These need Docker, Helm and a cluster; this ADR does not claim them done.

## Consequences

- A small team runs PostgreSQL, River and the identity provider by default and adds the rest one at a time,
  each with a named reason.
- Two review findings become documented non-goals instead of open TODOs, with the number at which to revisit.
- The AGPL question (`docs/content/server/licensing-agpl.md`) is a legal review, outside this ADR.
