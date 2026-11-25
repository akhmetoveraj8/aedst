---
title: "Scaling guide"
description: "ADR-0001 says a module is extracted \"when there is a measured, concrete reason\". This page is what makes that sentence operable: what to measure, at which..."
---

# Scaling guide

[ADR-0001](/decisions/0001-modular-monolith) says a module is extracted "when
there is a measured, concrete reason". This page is what makes that sentence
operable: what to measure, at which numbers to act, how to produce the numbers,
and what is known not to scale yet.

## The scaling model in one paragraph

`aedst-server` is stateless (JWT auth, no in-process sessions, idempotent
commands, config from the environment), so the first lever is **more replicas
behind the edge**. The single Postgres primary is the shared bottleneck, so the
second lever is **not spending it carelessly**: keyset pagination, indexes led
by `user_id`, one River job per event consumer inserted in the producer transaction, bounded tables, separate connection pools.
Extraction of a module is the third lever and is driven by the triggers below.
Media is in-process (its processing has its own River queue, `media`); realtime is
not implemented ([ADR-0008](/decisions/0008-realtime-and-media-extraction)).

## What to measure

Everything below is exported via OTLP (and on `/metrics` when the optional Prometheus endpoint is enabled).

| Signal | Metric | Healthy | Act when |
|---|---|---|---|
| Request latency | `http.server.*` / `rpc.server.*` (otelconnect, otelhttp) | p95 < 200 ms on the read path | p95 above SLO for 10 min |
| API pool saturation | `aedst_db_pool_connections{pool="api",state="acquired"}` vs `state="max"` | acquired < 80 % of max | at max for > 1 min, or `aedst_db_pool_empty_acquire_total` rising |
| Jobs pool saturation | same, `pool="jobs"` | idle connections available | at max for > 5 min → event/job backlog is coming |
| Pool wait | `aedst_db_pool_acquire_wait_seconds_total` (rate) | ~0 | rate > 0.1 s/s |
| Event / job lag | `aedst_river_oldest_available_age_seconds` | < 2 s | > 30 s for 5 min |
| Event / job backlog | `aedst_river_jobs{state=~"available|retryable"}` | ~0 | grows monotonically |
| Discarded event deliveries | `aedst_events_discarded_total{consumer}` | 0 | **any** increase |
| Go runtime | `go_*` / `runtime.*` | steady heap | heap or goroutines climb without bound |
| Database | `pg_stat_activity`, `pg_stat_statements`, replication lag | primary CPU < 60 % | see triggers |

## Extraction and split triggers

Extraction is mechanical ([architecture.md](/server/architecture#extraction-path)), but
it costs operational complexity, so it needs a measured cause:

| Symptom (sustained, after tuning) | Meaning | Response |
|---|---|---|
| One module's queries dominate `pg_stat_statements` and primary CPU > 60 % | Data-plane contention | Read replica for that module's reads (`AEDST_DATABASE_READ_URL`) → then database-per-module (schema-per-module already prepares it); step-by-step in the [Postgres scaling runbook](/server/runbook-postgres-scaling) |
| One module's handlers dominate CPU/memory on every replica | Compute-plane contention | Extract it to its own `cmd/` + Deployment; scale independently |
| A module needs a different failure domain (a slow dependency must not hold request goroutines) | Blast radius | Extract; the `platform/resilience` transport (circuit breaker, timeout, rate limit) is already in place |
| Event lag grows although consumers are healthy | River worker throughput / `river_job` churn | Raise the `default` queue size in `AEDST_JOBS_QUEUES`, run more worker replicas (River workers are safe to run concurrently), give deliveries their own queue, then their own River database; a broker behind the `events.Publisher` seam only when a consumer becomes a separate service ([ADR-0014](/decisions/0014-river-insert-tx-as-outbox)) |
| Media processing starves default-queue jobs despite the queue split, or realtime (long-lived connections, not built) is added | Different resource profile | Dedicated worker Deployment first (Helm `workers: [{name: media, queues: "media=4", replicas: 2}]`, shipped in `values-prod.yaml`; the API keeps `jobs.queues: "default=50"`); own deployable only if that is not enough — [ADR-0008](/decisions/0008-realtime-and-media-extraction) |

## Capacity planning arithmetic

- **Connections.** `replicas × (AEDST_DATABASE_MAX_CONNS + AEDST_DATABASE_JOBS_MAX_CONNS)`
  must stay below Postgres `max_connections` (or PgBouncer's server pool); behind a pooler the budget splits, see [Pooler sizing](#pooler-sizing-replicas-vs-pgbouncer).
  Twenty replicas at the defaults is 600 connections — put PgBouncer in
  transaction mode in front of the `api` pool
  ([database.md](/server/database#connection-pools-and-pgbouncer)).
- **Replica sizing.** Start from the Helm chart's requests/limits and the
  HPA (CPU 70 %, memory 80 %); tune from the load test below, not from guesses.
- **Rate limits.** Two layers, all cluster-wide through DragonflyDB so they do not
  weaken as replicas are added: per client address on the public procedures
  (`AEDST_AUTH_RATE_LIMIT_PER_MINUTE`), and per authenticated user on
  every other RPC (`AEDST_API_RATE_LIMIT_PER_MINUTE`, default 1200). All fail
  open: a DragonflyDB outage degrades limiting, it does not stop the API, and
  `/readyz` reports `degraded` instead of failing.
- **Load shedding.** `AEDST_MAX_IN_FLIGHT` (default 1024) caps concurrent
  requests per instance; the excess gets an immediate `429` with `Retry-After`
  instead of queueing until latency collapses for everyone. Probes are exempt.
  Size it from the load test: the p95 at which throughput stops growing is the
  limit, divided by the replica's CPU headroom.

### Pooler sizing: replicas vs PgBouncer

With `AEDST_DATABASE_POOLER=pgbouncer` the two pools are different budgets, so the
one-line formula above splits in two:

| Budget | Formula | Must stay under |
|---|---|---|
| Direct connections (jobs pool, migrations, admin) | `replicas × JOBS_MAX_CONNS` (+ the pooler's own server connections) | Postgres `max_connections` minus reserved/superuser slots |
| Pooler server connections | `Pooler instances × default_pool_size` (per database/user pair; each CloudNativePG Pooler instance is its own PgBouncer) | Postgres `max_connections` minus the direct budget |
| Pooler client connections | `replicas × MAX_CONNS` | `max_client_conn` of **each** PgBouncer (clients spread over instances, size for the worst case) |

Worked example (the shipped `cluster.yaml` prod overlay + `values-prod.yaml`: 3 Pooler
instances, `default_pool_size: 40`, `max_client_conn: 2000`, `max_connections: 400`,
`maxConns=20`, `jobsMaxConns=10`, autoscaling up to 20 API pods, one `media` worker
Deployment of 2 pods): 20 pods = 400 client connections (fine, 2000), (20 + 2) × 10 =
220 direct jobs connections, up to 3 × 40 = 120 pooled server connections, and 40
reserved for ZITADEL: 380 ≤ 400, it fits. The chart enforces this arithmetic:
`database.serverMaxConnections`, `reservedConns` and `poolerServerConns` feed a
check that fails the render when `(API replicas + worker replicas) × jobsMaxConns +
(pooler server connections, or API replicas × maxConns without a pooler) + reservedConns`
exceeds the server limit. (The previous shipped `jobsMaxConns: 30` gave 660 direct
connections against `max_connections: 300`: it never fitted.) When it does not fit,
lower `default_pool_size`, `jobsMaxConns` or `maxReplicas`, or raise `max_connections`
(with RAM: each backend costs memory). `default=50` queue slots on 10 jobs connections is deliberate (a handler holds a connection only for its transaction); if the delivery backlog grows, raise `jobsMaxConns` and re-check the budget. A small
`default_pool_size` is usually right: server connections only need to cover the
number of **concurrently running transactions**, not clients. Start near 2-3 ×
Postgres cores per pooler instance and let the load test below confirm it.

Signals that the pooler is undersized (all checked by the load-test watcher):

- `SHOW POOLS`: `cl_waiting` > 0 for more than a moment, or `maxwait` growing, means
  clients queue for a server connection. The app side shows
  `aedst_db_pool_acquire_wait_seconds_total` on the `api` pool rising and request
  latency growing before any error appears. Raise `default_pool_size` (if Postgres
  has CPU/connection headroom) or shorten transactions; adding replicas makes it worse.
- `query_wait_timeout` errors / `no more connections allowed (max_client_conn)`:
  raise `max_client_conn` or lower `MAX_CONNS`.
- Postgres `pg_stat_activity` count near `max_connections`: the direct budget
  (jobs pools) is the usual culprit, not the pooled one.

### Failure signatures behind a transaction pooler

| Symptom (server log / River) | Cause | Fix |
|---|---|---|
| `prepared statement "stmtcache_..." does not exist` or `... already exists` | Named prepared statements through transaction pooling | `AEDST_DATABASE_POOLER=pgbouncer` (forces CacheDescribe); check nothing else (a sidecar, a script) connects with the pgx default |
| `unsupported startup parameter: statement_timeout` | A client sends startup parameters the pooler rejects | Use the pooler mode above (not sent) and keep `ignore_startup_parameters` as a safety net |
| River jobs sit `available` and are not picked up; leader election flaps | LISTEN/NOTIFY swallowed by the pooler | Direct DSN for the jobs pool, or `AEDST_JOBS_POLL_ONLY=true` |
| Lock appears "held by another session" long after its holder is gone, or two replicas believe they hold it | Session advisory lock taken through the pooler leaked onto a shared server connection | Never use `lock.Locker` on a pooled pool (the type system prevents it); use `TryXact`/`Xact` |
| `idle in transaction` sessions piling up | Long transaction holding a pooled server connection | `idle_in_transaction_session_timeout` on the role; shorten the transaction |

Run the rehearsal with `task loadtest:pgbouncer` (next section).

## Load testing

`apps/server/test/load/` holds the [k6](https://k6.io) scripts:

- `api.js` — the main suite across tasks + search over Connect JSON, with three
  scenarios selected by `SCENARIO`: `smoke` (CI gate), `load` (constant arrival
  rate) and `stress` (ramping until thresholds fail). Run with
  `task load SCENARIO=smoke|load|stress RATE=… DURATION=…`; CI runs smoke, then
  load at `RATE=10`.
- `scenario_tasks.js` — a realistic mix (register → create task with an
  `Idempotency-Key` → list first page and follow the cursor → complete task)
  at a constant arrival rate with per-operation p95/p99 and error-rate
  thresholds.

- `pgbouncer.js` — the **PgBouncer profile**: authenticated create (a due date
  enqueues a River reminder in the request transaction via `InsertTx`), idempotent
  replay, update/complete, and reads whose filter/sort/page-size vary on every
  iteration so each pooled connection meets every statement shape. Thresholds:
  p95/p99 per RPC, error rate, zero 5xx, zero responses mentioning
  prepared-statement/pool failures, zero dropped iterations.

```bash
# Needs Docker and k6. Starts postgres+cache+PgBouncer, migrates, runs 4 server
# replicas behind nginx (:8088) through PgBouncer, then drives pgbouncer.js while
# scripts/loadtest-pgbouncer-watch.sh samples SHOW POOLS / pg_stat_activity.
task loadtest:pgbouncer REPLICAS=6 RATE=80 DURATION=5m
# per-replica pools: LOADTEST_API_MAX_CONNS=8 LOADTEST_JOBS_MAX_CONNS=4 (compose env)
# pass/fail limits: MAX_CL_WAITING=5 MAX_WAIT_S=1 MAX_PG_CONNS=<n> STUCK_JOB_S=120
```

  The run fails when (a) `check-config` finds PgBouncer not in transaction mode or
  with `max_prepared_statements` unset, (b) a k6 threshold breaks, (c) sampled
  `cl_waiting` or `maxwait` exceed the limits, (d) the replicas' logs contain
  `prepared statement ... does not exist/already exists`, `lock held by another
  session`, unsupported-startup-parameter or pool errors, or (e) River has jobs
  stuck `available` or recently `discarded`. Pick `REPLICAS × (API + JOBS conns)`
  against `DEFAULT_POOL_SIZE` (20 in compose) using the table above; set
  `REPLICAS=8` to see the queueing signals on purpose.
  **Status: the scripts pass `k6 inspect` and `bash -n`, and the compose file
  `config`-validates; the scenario has never been run against a live PgBouncer
  (Docker was unavailable when it was written). The first real run is its
  acceptance test.** On Kubernetes, run `api.js`/`pgbouncer.js` from a pod in the
  cluster at the pooler Service and read `SHOW POOLS` through the CloudNativePG
  Pooler's admin console instead of the compose helper.

```bash
task up && task migrate && task run          # in one shell
task test:load:tasks RATE=50 DURATION=5m     # in another
```

Procedure to produce the numbers the triggers above need:

1. Run against a production-shaped environment (not a laptop) with a
   production-sized dataset (seed millions of tasks; keyset pagination and the
   trigram indexes only show their value at size).
2. Step `RATE` up until a threshold fails; record the highest passing rate, the
   p95/p99 per operation, and which signal in the table above moved first.
3. Record the result below, with the commit, instance sizes and dataset size.
   A number without its conditions is not a baseline.

### Recorded baselines

**2026-10-08 - local dev machine, River `InsertTx` event path (development
baseline, not a capacity figure).** Repository commit `a968f8c` plus the then
uncommitted working tree. Setup: Windows 11, Intel Core i5-13400 (16 logical
cores), 32 GB RAM; one `aedst-server` process, k6 and PostgreSQL 18.6 (the
`embedded-postgres` build, default settings, fsync on) all on the same host, so
they compete for CPU. **Direct connection to Postgres, no pooler (no PgBouncer),
no DragonflyDB** (`/readyz` `degraded`, limiters fail open), `AEDST_API_RATE_LIMIT_PER_MINUTE=0`
and the auth limits off, one OIDC access token (`TOKEN`) shared by all
virtual users, `AEDST_MAX_IN_FLIGHT=0`. Empty database at the start of each series
(tables hold tens of thousands of rows, not millions). Scenario:
`test/load/scenario_tasks.js`, `RATE` iterations/s held for 45 s; each iteration is 4
requests (create, list page 1, list page 2, complete) and produces one event, which
River delivers to two consumers (notifications, search), i.e. two
`platform.event_delivery` jobs. The previous numbers (relay path, ADR-0011) were
removed; they do not apply to this path.

*API path*, server defaults (`AEDST_DATABASE_MAX_CONNS=20`, jobs pool 10,
`AEDST_JOBS_QUEUES=default=10,media=2`). Each rate was run once or twice; the
thresholds are those in the script (p95 create/complete < 300 ms, list < 200 ms,
no dropped iterations):

| Iterations/s (RATE) | Requests/s | p95 create / list / complete | Verdict |
|---|---|---|---|
| 50 | ~150 | 2.5 / 1.5 / 1.5 ms | pass |
| 150 | ~460 | 4.0 / 3.0 / 2.5 ms | pass |
| 250 | ~765 | 23 / 7.6 / 7.4 ms | pass |
| 400 | ~1 180-1 220 | run 1: 406 / 722 / 400 ms, 912 dropped; run 2: 5.0 / 8.5 / 3.6 ms | one fail, one pass |
| 600 | ~1 810-1 830 | run 1: 5.5 / 10 / 4.0 ms; run 2: 253 / 358 / 225 ms, 572 dropped | one pass, one fail |
| 800 | ~2 300 | 608 / 1 089 / 621 ms, 2 695 dropped | fail |

So the API path on this machine is comfortably fine up to 250 iterations/s
(~760 requests/s), and the 400-600 band is the unstable knee: the same rate passes
or fails from run to run (shared CPU with the database, k6 and other processes,
checkpoints), so treat anything in that band as "not reliably sustained", not as a
capacity number. No request failures (`http_req_failed`) were recorded in the runs inspected; failures were threshold breaches (latency, dropped iterations).

*Event delivery is the first real limit, not the API.* During the series above
(default queue size) delivery lagged far behind: after the 250-800 it/s runs
`platform.event_delivery` held ~350 000 `available` jobs and drained at only
~85-90 jobs/s (about 45 events/s, two consumers per event) once the load stopped.
Isolated runs, sampling `river_job` while the load ran:

| Config | Load | Delivery result |
|---|---|---|
| defaults (`default=10`, jobs pool 10) | 25 it/s (~50 jobs/s) | keeps up, backlog stays under ~20 jobs |
| defaults | 100 it/s (200 jobs/s demanded) | ceiling ~85 jobs/s; backlog grows ~120 jobs/s, oldest job 60 s old after 2 min |
| `AEDST_JOBS_QUEUES=default=50,media=2`, `AEDST_DATABASE_JOBS_MAX_CONNS=30` | 100 it/s | keeps up (backlog < 60 jobs) |
| same | 250 it/s (500 jobs/s demanded) | ~370 jobs/s delivered; backlog peaked ~6 700 jobs (~18 s of work at that delivery rate), drained within ~25 s of the load ending |

Reading (the mechanism is a hypothesis, only the numbers are measured): River's default fetch settings appear to cap short-job throughput per queue slot, so delivery throughput scales with the queue size
(`default=10` gave ~85 jobs/s, `default=50` ~370 jobs/s here; the second figure was
not tested higher). **Raise `AEDST_JOBS_QUEUES` (and `AEDST_DATABASE_JOBS_MAX_CONNS` to
match) before adding replicas for event lag**, as the trigger table says. Neither
queue size nor pool was tuned beyond these two points.

Correctness under load held: in the last series 22 778 tasks were completed, 22 778
`notifications` rows and exactly 45 556 (2 x 22 778) completed
`platform.event_delivery` jobs existed once the backlog drained, with zero
discarded or retryable jobs.

What this does **not** show: anything about PgBouncer / transaction pooling (not
available here, `task loadtest:pgbouncer` has still never run), a production-shaped
dataset, multiple replicas, real network latency, or DragonflyDB-backed rate limiting.
The first signal to move under overload in the earlier (2026-09-29) series was the
API pool (`aedst_db_pool_empty_acquire_total`); this series did not sample the
pool metrics, so that is **not re-measured**.

**Index behaviour on the 1 M-row dataset** (measured 2026-09-29 with `EXPLAIN ANALYZE`, not repeated on 2026-10-08; the queries are unchanged and independent of the event path; hot user with
400 k tasks): fetching a page at depth 300 000 with `OFFSET` scanned 300 020
index entries and took **54.7 ms**; the same page with the keyset predicate read
21 rows and took **0.032 ms**, and the first page 0.022 ms. Ordering by due date
uses its own keyset index (0.043 ms). Substring search (`ILIKE '%…%'`) uses the
two `pg_trgm` GIN indexes (bitmap index scan, ~4.5 ms) instead of a scan of the
user's rows.

## Client compatibility and build scaling

Old app versions stay working through additive-only proto changes, a
`X-Aedst-Client` header, and a server-side minimum-version gate
(`AEDST_MIN_CLIENT_VERSIONS`) — see
[ADR-0009](/decisions/0009-api-compatibility-and-client-versioning). That ADR
also lists the per-platform build-cache recommendations (Gradle build cache,
Tuist binary cache, Cargo build caching) to adopt as the feature count
grows; they are recommendations and are not enabled yet.

## Known limits

Things that are deliberately not solved yet, so nobody assumes they are:

- **Only a single-machine load baseline** (above); no production-shaped measurement yet.
- **Retention is time-based only.** `platform.idempotency_keys` and
  `auth.sessions` are purged in batches by River periodic jobs, and finished
  `river_job` rows (event deliveries included) by River's own cleaner, so the
  tables are bounded by *age*. At very high volume the `DELETE`s themselves
  become the cost; the next step is time partitioning and dropping whole
  partitions ([ADR-0010](/decisions/0010-caching-and-data-partitioning)).
- **Event delivery throughput is bounded by the `default` queue size.** On the dev laptop `default=10` delivered ~85 jobs/s (about 45 events/s with two consumers) and `default=50` ~370 jobs/s ([baselines](#recorded-baselines)); the API path outran both, so a sustained burst builds a backlog that drains afterwards. Size `AEDST_JOBS_QUEUES` from the expected events/s x consumers.
- **Events share `river_job`.** One row per consumer per event, in the same
  table as every other job, so a burst of events is a burst of queue churn in
  the primary database. The escape hatch is a dedicated queue and then a
  dedicated River database for deliveries, not a different mechanism
  ([ADR-0014](/decisions/0014-river-insert-tx-as-outbox)).
- **No cross-job event ordering.** Consumers must tolerate reordering
  ([events.md](/server/events)).
- **Delivery latency depends on River's fetch path.** With LISTEN/NOTIFY (direct
  jobs DSN) a committed delivery job is picked up immediately; with
  `AEDST_JOBS_POLL_ONLY` (transaction-pooled jobs pool without a direct DSN) it
  waits for River's poll interval.
- **The synchronous cross-module path is unproven in production code.** The
  `api/` seam and the dual-transport RPC exist and are tested in isolation, but
  no module calls another synchronously yet ([modules.md](/server/modules)).
- **No caching layer.** DragonflyDB is used for rate limiting only; the strategy is
  decided in [ADR-0010](/decisions/0010-caching-and-data-partitioning) and
  implemented when a measured read path needs it.
- **Single primary.** Writes all go to one primary. An optional read pool (`AEDST_DATABASE_READ_URL`, used by search only) exists but was never run against a real replica; partitioning and sharding are a roadmap
  ([ADR-0010](/decisions/0010-caching-and-data-partitioning)), not built. Path: [Postgres scaling runbook](/server/runbook-postgres-scaling).
- **Infrastructure is described, not provisioned.** There is a Helm chart, but
  no OpenTofu or Argo CD, and the chart has not been rendered against
  a cluster ([deployment.md](/server/deployment)).
