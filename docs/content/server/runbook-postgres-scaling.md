---
title: "Runbook: scaling Postgres"
description: "The path, in the order to take it, and what each step costs: 1. tune the primary → 2. PgBouncer → 3. read replica → 4. database-per-module. Take a step only..."
---

# Runbook: scaling Postgres

The path, in the order to take it, and what each step costs: **1. tune the primary
→ 2. PgBouncer → 3. read replica → 4. database-per-module.** Take a step only when
its trigger fires; each is reversible until the last one. Capacity arithmetic and
load-test procedure are in the [scaling guide](/server/scaling); the HA topology is
in [deployment](/server/deployment#high-availability-postgresql); alert-by-alert
responses are in the [runbook](/server/runbook).

## What is verified and what is not

| Step | Code in the repo | Verified here | Not verified |
|---|---|---|---|
| 1 Tuning | CloudNativePG parameters (`deployments/k8s/postgres/base/cluster.yaml`) | Manifest schema-validated offline | Any effect on a real workload |
| 2 PgBouncer | `AEDST_DATABASE_POOLER`, config validation, `Pooler` manifest, k6 scenario `test/load/pgbouncer.js` | Config validation (unit tests); a load run is recorded in [scaling.md](/server/scaling#recorded-baselines), taken on one developer machine | Never run on a cluster; not re-run for this page (Docker was unavailable) |
| 3 Read replica | `AEDST_DATABASE_READ_URL` → `Env.ReadPool`, used by search | Server boots with a separate read pool, search works through it, the pool is a distinct Postgres client (`TestServer_ReadReplicaPool`, against one Postgres 18.6 that stood in for the replica); config validation | **Replication lag behaviour**: there was no real replica. CloudNativePG service names are from its documentation |
| 4 Database-per-module | Only the precondition: no foreign key or view crosses a module schema (`TestSchemas_NoForeignKeysOrViewsCrossModuleSchemas`); `goose_<module>` tables per module | That precondition | **The whole move.** The server has one `Pool`/`JobsPool`; per-module pools do not exist yet (see step 4). No dump/restore or logical replication was rehearsed (no `pg_dump`/`psql` on the authoring machine) |

Treat steps 1, 2 and 4 as a plan to rehearse in staging, not as proven.

## 0. Measure before moving

Do not scale the database on a feeling. The numbers that start each step:

| Signal | Where | Go to |
|---|---|---|
| Primary CPU > 60 % sustained and the top statements are known | node metrics; `pg_stat_statements` below | 1 |
| `AedstDBPoolWaiting` / `AedstDBPoolSaturated` firing, or PgBouncer `cl_waiting > 0` for minutes | alerts; `SHOW POOLS` | 1 (fix queries) then 2 |
| Connections near `max_connections` after raising replicas | `SELECT count(*) FROM pg_stat_activity` | 2 |
| One read-heavy, lag-tolerant module dominates `pg_stat_statements` (`total_exec_time`) and primary CPU > 60 % | below | 3 |
| One module's tables, vacuum or locks hurt the others, or it needs its own failure domain/backup/upgrade cadence | `pg_stat_user_tables`, `pg_locks` | 4 |

```sql
-- Top statements by total time (pg_stat_statements is enabled in cluster.yaml).
SELECT left(query, 80) AS query, calls, round(total_exec_time) AS total_ms,
       round(mean_exec_time::numeric, 2) AS mean_ms, rows
FROM pg_stat_statements ORDER BY total_exec_time DESC LIMIT 15;

-- Which module (schema) the load comes from.
SELECT schemaname, sum(seq_scan) AS seq_scans, sum(idx_scan) AS idx_scans,
       sum(n_tup_ins + n_tup_upd + n_tup_del) AS writes
FROM pg_stat_user_tables GROUP BY schemaname ORDER BY writes DESC;
```

## 1. Tune the single primary

Cheapest, no application change. Order: queries and indexes first, parameters last.

1. Fix the top statements: missing index (create `CONCURRENTLY` in a
   `-- +goose NO TRANSACTION` migration; rules in
   `apps/server/AGENTS.md`), `OFFSET` pagination, `count(*)` on a paging path.
2. Check bloat/vacuum: `SELECT relname, n_dead_tup, last_autovacuum FROM pg_stat_user_tables ORDER BY n_dead_tup DESC LIMIT 10;`. High-churn tables
   (`river_job`, idempotency keys) get per-table `autovacuum_vacuum_scale_factor` before anything else.
3. Parameters in `cluster.yaml` (`shared_buffers` about 25 % of RAM, `effective_cache_size`
   about 50-75 %, `work_mem` small because it is per sort per connection).
   Apply with a rolling restart; CloudNativePG restarts replicas first.
4. Vertical scale (CPU/RAM/IOPS) is a legitimate step here; the HA topology fails over during the roll.

**Verify:** the same `pg_stat_statements` query after a day of traffic; p95 from the
dashboard; cache hit ratio
`SELECT sum(blks_hit)::float / nullif(sum(blks_hit + blks_read), 0) FROM pg_stat_database;` stays above about 0.99.
**Rollback:** parameter changes are reverted in the manifest (another rolling restart); indexes are dropped `CONCURRENTLY`.

## 2. PgBouncer

Already built: the API pool goes through a transaction-mode pooler, the jobs pool
connects directly.

1. Run the pooler (Kubernetes: the CloudNativePG `Pooler` in `cluster.yaml`; Compose: the PgBouncer service).
2. Set `AEDST_DATABASE_URL` to the pooler, `AEDST_DATABASE_DIRECT_DSN` to the cluster `-rw` service,
   `AEDST_DATABASE_POOLER=pgbouncer` (Helm `database.pooler`, `database.directDsnSecretKey`).
   Startup fails if neither a direct DSN nor `AEDST_JOBS_POLL_ONLY=true` is set: River's
   LISTEN/NOTIFY and session advisory locks do not survive transaction pooling.
3. Budget connections with the table in [scaling.md](/server/scaling#pooler-sizing-replicas-vs-pgbouncer).

**Verify** (on the pooler's admin console and Postgres):

```sql
SHOW POOLS;    -- cl_waiting must stay 0; sv_active well below pool_size
SHOW STATS;    -- avg_wait_time small (milliseconds)
SELECT application_name, count(*) FROM pg_stat_activity GROUP BY 1;  -- jobs pool still direct
```

Failure signatures (prepared-statement errors, stuck advisory locks) are tabulated in
[scaling.md](/server/scaling#failure-signatures-behind-a-transaction-pooler).
**Rollback:** point `AEDST_DATABASE_URL` at the cluster `-rw` service and set the pooler to `none`; pods roll; no data is touched.

## 3. Read replica

### What the application does

`AEDST_DATABASE_READ_URL` (Helm: `database.readDsnSecretKey`, size with `database.readMaxConns`)
opens a third pool, `Env.ReadPool` (metric label `pool="read"`, Postgres
`application_name` `aedst-server-read`). Unset, `ReadPool` **is** the primary pool, so no module
branches on whether a replica exists. A module opts in per repository; **today only
`search`** reads from it (its projection is already eventually consistent, so replica lag
adds to a delay that exists anyway). Everything that writes, reads its own write, or sits
in a transaction with a write stays on the primary, and the River/event path never uses it.
If the replica is down, `/readyz` reports `database_read` as `degraded` (optional check)
and search errors; the instance is **not** pulled from rotation.

The URL must differ from `AEDST_DATABASE_URL` (validated). With `AEDST_DATABASE_POOLER=pgbouncer`
the read pool uses the same pooled-safe mode, so point it at a replica-side pooler or the replica directly.

### Steps

1. **Replicas exist.** The cluster already runs 3 instances (1 primary, 2 standbys, one synchronous).
   CloudNativePG exposes `aedst-pg-rw` (primary), `aedst-pg-ro` (standbys only) and `aedst-pg-r` (any
   instance); use **`-ro`** so reads never land on the primary (service names per the CloudNativePG
   documentation, not verified on a cluster).
2. **Secret.** Add a key with `postgres://aedst:…@aedst-pg-ro:5432/aedst?sslmode=…` to the app secret.
3. **Helm.** `database.readDsnSecretKey: <key>`; optionally `database.readMaxConns`. Roll one environment (staging) first.
4. **Budget.** `replicas × readMaxConns` counts against the *standbys'* `max_connections`, not the primary's.

### Verify

```sql
-- On the primary: every standby streaming, lag in the milliseconds.
SELECT application_name, state, sync_state, write_lag, flush_lag, replay_lag FROM pg_stat_replication;
-- On a standby: seconds behind (only meaningful while the primary writes).
SELECT now() - pg_last_xact_replay_timestamp() AS replay_delay;
-- The app's read pool is connected to the replica, not the primary (run on the replica):
SELECT count(*) FROM pg_stat_activity WHERE application_name = 'aedst-server-read';
```

Application side: `aedst_db_pool_*{pool="read"}` shows connections and `empty_acquire_total`;
search latency should not regress; the primary's `pg_stat_statements` loses the search statements.

### Alert thresholds (proposed; not shipped in the Helm alert rules)

| Condition | Level |
|---|---|
| `replay_delay` > 5 s for 10 min | warn |
| `replay_delay` > 30 s for 5 min | page: search results are stale; consider unsetting the read URL |
| `AedstDBPoolWaiting` on `pool="read"` | warn: raise `readMaxConns` or add a standby |
| `database_read` degraded in `/readyz` for > 5 min | page |

The existing pool alerts in the chart match all `pool` labels; a replication-lag alert needs the
CloudNativePG exporter metric, whose exact name was **not** verified here, so none was written.

### Rollback

Remove `database.readDsnSecretKey` (or unset `AEDST_DATABASE_READ_URL`) and roll the pods: `ReadPool`
becomes the primary pool again within one rollout. No data or schema is involved.

### Adding a module to the read pool

Only for reads that tolerate stale data: use `env.ReadPool` in that module's `Setup` for the read
repository, keep writes on `env.Pool`. A read that must see the caller's own write (create then
list) must not; do not route it, fix the query or cache it instead.

## 4. Database-per-module

**Do not start this from an alert.** It is the biggest step and, in the current code, **not possible
without changes** (see "Blockers"). It exists as a path because the data model was shaped for it:

- one Postgres schema per module and **no foreign key or view crosses a schema** (enforced by
  `TestSchemas_NoForeignKeysOrViewsCrossModuleSchemas`);
- one goose version table per module in the database's `public` schema (`goose_<module>`, e.g. `goose_integrity`;
  `task migrate` runs `goose -dir migrations/<m> -table goose_<m>`), so a module's migration history moves with it;
- no module reads another's tables ([ADR-0006](/decisions/0006-module-boundaries)).

### Blockers in the current code (owner decision needed before step C)

| Blocker | Why | What it needs |
|---|---|---|
| One pool | `modulekit.Env` has a single `Pool` and `JobsPool`, and `cmd/server` opens one `AEDST_DATABASE_URL` | A per-module DSN override (for example `AEDST_DATABASE_URL_<MODULE>` and `Env.PoolFor(module)`), including a jobs pool for that module's retention. Not implemented |
| Events are River jobs inserted in the producer's transaction | `river_job` must be in the same database as the producer's tables; a River client reads one database | A River client per database, and consumers' pools must be that database's. Modules that publish or consume events (`tasks`, `media`, `notifications`, `search`) are therefore **not** first candidates |
| Admin transactions | `admin` opens one transaction and passes it to `tasks` and `notifications` (`DeleteTaskTx`, `BroadcastTx`) | `admin`, `tasks`, `notifications` stay in one database, or the pattern is replaced by an event |
| Shared infrastructure | `platform.idempotency_keys` and River's tables are per database | Run the `platform` migrations and River migrations in each new database (`task migrate` does the former; the server runs the latter on start) |

**First candidates:** `integrity` and `appattest`. They own only their own tables, use no events and no
idempotency keys, and need only the request pool (their retention uses the jobs pool, see blocker one).
They have no sequences, so none needs resetting.

### Steps (rehearse in staging first)

**A. Prepare the target (no traffic change).**
1. Create the database (CloudNativePG: a `Database` resource on the same or a new cluster) and a role
   with privileges on that schema only. Revoke `CONNECT` from `PUBLIC`.
2. Apply `platform` and the module's migrations to it, with the same table names as today:
   `goose -dir migrations/platform -table goose_platform postgres "$TARGET" up`, then
   `goose -dir migrations/integrity -table goose_integrity postgres "$TARGET" up`.
3. Confirm versions match: `SELECT max(version_id) FROM goose_integrity WHERE is_applied;` on source and target.

**B. Copy the data.**
- *Short downtime / small tables:* `pg_dump --data-only --schema=integrity` from the source, `psql` into the target.
- *Near-zero downtime:* logical replication (needs `wal_level = logical` on the source).
  Source: `CREATE PUBLICATION integrity_move FOR TABLES IN SCHEMA integrity;`
  Target: `CREATE SUBSCRIPTION integrity_move CONNECTION '…' PUBLICATION integrity_move;`
  Replicated sequences are not copied (this schema has none; any module that does needs `setval` before cutover).

**C. Verify before cutover.**
```sql
-- same on both sides, per table:
SELECT count(*), max(verified_at) FROM integrity.verified_tokens;
-- logical replication caught up (on the target):
SELECT subname, received_lsn, latest_end_lsn, latest_end_time FROM pg_stat_subscription;
```

**D. Cut over.** Deploy the version that routes the module to the target (blocker one), with the
subscription still running; once it serves traffic, `DROP SUBSCRIPTION`. Writes made on the target after the
cut are not on the source.

**E. Soak and retire.** Keep the source schema for a week with `REVOKE INSERT, UPDATE, DELETE` on it, then
`DROP SCHEMA integrity CASCADE` and delete `goose_integrity` on the source.

### Rollback

- Before D: `DROP SUBSCRIPTION`, drop the target database. Nothing changed for users.
- After D, within the soak: route the module back to the source. Data written to the target since the cutover
  is lost unless a **reverse** publication/subscription was set up before D; for `integrity` and `appattest`
  (replay-protection rows that expire in minutes/days) losing them is acceptable, for anything with business
  data it is not: set up the reverse stream first.
- After E: restore from backup (PITR) into a scratch cluster; there is no quick way back.

### Alert thresholds during a move

| Condition | Level |
|---|---|
| Subscription `latest_end_time` older than 1 min while the source writes | warn |
| Row-count mismatch between source and target after replication is idle | stop; do not cut over |
| Error ratio of the moved module's RPCs above its baseline for 5 min after D | roll back |
