---
title: "Runbook"
description: "One section per alert in apps/server/deployments/helm/aedst-server/files/alerts.rules.yaml; each alert's runbookurl points at the heading with the same..."
---

# Runbook

One section per alert in `apps/server/deployments/helm/aedst-server/files/alerts.rules.yaml`; each alert's `runbook_url` points at the heading with the same name. Dashboard: the `aedst-server` Grafana dashboard (same chart). Logs: every server-side failure is logged as `rpc failed` with `procedure`, `code`, the real `error`, and `trace_id`/`request_id`; find the trace from the log line, not the other way round.

Severity `page` = act now, `ticket` = fix in working hours.

## AedstNoInstancesReporting

**Meaning.** No pod exports metrics: every replica is down, crash-looping, or the scrape is broken.
1. `kubectl -n <ns> get pods -l app.kubernetes.io/name=aedst-server` — any `Running/Ready`? If yes, the problem is scraping (ServiceMonitor selector, NetworkPolicy blocking the metrics port), not the service.
2. Crash loop: `kubectl logs --previous <pod>`. Startup fails fast and loudly on bad config (`config: …`), an unreachable database (`database: ping`), or an invalid role policy (`role policy names unknown procedure …`). Fix the value and roll out.
3. Failed migration Job blocks the rollout: `kubectl get job -l app.kubernetes.io/component=migrate`, read its logs. A `lock_timeout` error means DDL queued behind traffic — retry off-peak.

## AedstHighErrorRatio

**Meaning.** More than 2% of requests are 5xx for 10 minutes.
1. Dashboard → *Requests per second by status* and *p95 latency by RPC method*: one method or all?
2. Logs: `rpc failed` lines carry the cause. Group by `error`; typical causes are the database (`context deadline exceeded`, `too many connections`), a bad deploy (compare with the rollout time), or a dependency of a module.
3. If the cause is a bad deploy: `helm rollback aedst-server`. Migrations are forward-compatible by policy (squawk), so rolling the binary back is safe.
4. Database pool exhaustion → see [AedstDBPoolWaiting](#aedstdbpoolwaiting).

## AedstHighLatencyP95

**Meaning.** p95 above 500 ms for 10 minutes (429 and 5xx excluded — they have their own alerts).
1. *p95 latency by RPC method* — is it one RPC? A list endpoint with a search term is the usual suspect (`ILIKE` on a table larger than the trigram index helps with).
2. *Connections in use vs max* and *Time spent waiting for a connection*: if the pool is saturated, latency is queueing, not slow queries.
3. `pg_stat_statements` ordered by `total_exec_time`; `EXPLAIN (ANALYZE, BUFFERS)` the top query. Keyset queries must use their `(user_id, sort_key, id)` index — a sequential scan means a missing or unusable index.
4. CPU-bound pods (HPA at max) → raise `autoscaling.maxReplicas`, then check `database.maxConns` × replicas against Postgres `max_connections` ([scaling.md](/server/scaling)).

## AedstShedding429

**Meaning.** More than 1 request/s is being answered 429.
- Per-user limit (`AEDST_API_RATE_LIMIT_PER_MINUTE`): one user or client is hot. Find it: `rl:user:<id>` keys, or the `user_id` on 429 log lines. A misbehaving client is fixed in the client; a legitimately busy integration may need a higher limit.
- Load shedding (`AEDST_MAX_IN_FLIGHT`): the instance is saturated. Scale out first; raise the cap only if CPU is idle while requests are shed.

## AedstDBPoolSaturated

**Meaning.** A pool is above 80% in use for 5 minutes (`api` = requests, `jobs` = River, event consumers).
1. Long transactions: `SELECT pid, now() - xact_start AS age, state, left(query, 80) FROM pg_stat_activity WHERE application_name LIKE 'aedst-server%' ORDER BY age DESC LIMIT 10;`
2. `api` pool: slow queries (see AedstHighLatencyP95) or too few connections for the traffic. `jobs` pool: a burst of events or a slow consumer.
3. Adding connections is the last resort: `replicas × (MAX_CONNS + JOBS_MAX_CONNS)` must stay under Postgres `max_connections` / PgBouncer's server pool.

## AedstDBPoolWaiting

**Meaning.** Callers spend more than 0.1 s per second waiting for a connection: the pool is the bottleneck now.
Follow [AedstDBPoolSaturated](#aedstdbpoolsaturated) step 1 immediately. If a single slow query or an idle-in-transaction session holds connections, terminate it (`SELECT pg_terminate_backend(pid)`), then fix the cause. `idle_in_transaction_session_timeout` (30 s) and `statement_timeout` (15 s) already bound the damage.

## AedstJobsLagging

**Meaning.** The oldest River job that is ready to run (event deliveries included) has waited more than 30 s: nothing is fetching it, or consumers are too slow.
1. Is any replica working the queue? `AEDST_JOBS_QUEUES` must include `default` on at least one running pod (empty = insert-only). Logs of the pods: River `producer` / `client` lines.
2. Failing consumers: `aedst_events_failed_total` rising → see [AedstEventDeliveryFailing](#aedsteventdeliveryfailing).
3. Nothing failing but lag grows: the `jobs` pool is saturated ([AedstDBPoolSaturated](#aedstdbpoolsaturated)), the `default` queue size is too small (raise it in `AEDST_JOBS_QUEUES`), or workers are slow. With `AEDST_JOBS_POLL_ONLY` jobs also wait for River's poll interval.
4. Inspect: `SELECT queue, kind, state, count(*), min(scheduled_at) FROM river_job WHERE state IN ('available','retryable','running') GROUP BY 1,2,3 ORDER BY 5;`

## AedstJobsBacklogGrowing

**Meaning.** More than 1000 jobs are available or retrying and the number has been rising for 15 minutes: producers outpace the workers. Same steps as [AedstJobsLagging](#aedstjobslagging); if workers are healthy, add worker replicas or queue slots, and if `river_job` churn from deliveries is the cause give deliveries their own queue ([ADR-0014](/decisions/0014-river-insert-tx-as-outbox) says broker only when a consumer becomes a separate service).

## AedstEventDeliveryFailing

**Meaning.** A consumer keeps failing; River retries each delivery with its backoff (attempt^4 seconds, 10 attempts, about 4.3 h in total).
1. Logs: `events: delivery failed` with `consumer`, `event_id`, `attempt`, `discarded=false` and the handler's error.
2. Fix the consumer (or its dependency). Retries succeed on their own once it is healthy — no manual action; handlers are idempotent, so a delivery that had partly applied is safe to run again.
3. Fix it before attempt 10, or the delivery is discarded ([AedstEventDiscarded](#aedsteventdiscarded)).

## AedstEventDiscarded

**Meaning.** A delivery exhausted its attempts (or was malformed) and River parked it as `discarded`; its consumer is missing that event. Paged on purpose: this is silent data divergence.
1. Find it: `SELECT id, args->>'consumer' AS consumer, args->>'event_type' AS event_type, args->>'event_id' AS event_id, attempt, finalized_at, errors->-1->>'error' AS last_error FROM river_job WHERE kind = 'platform.event_delivery' AND state = 'discarded' ORDER BY finalized_at DESC;` and the `events: delivery failed … discarded=true` log line.
2. Fix the root cause (a consumer bug, a bad payload).
3. Replay once the fix is deployed: retry the job with River (`riverui`, or `client.JobRetry(ctx, <id>)`), or `UPDATE river_job SET state = 'available', scheduled_at = now(), max_attempts = max_attempts + 5, finalized_at = NULL WHERE id = <id>;` — handlers are idempotent, so a consumer that already applied the event is not affected.
4. A delivery that can never succeed (its payload is invalid for good) stays discarded as a record; note it in the incident. Discarded jobs are kept for `AEDST_JOBS_DISCARDED_RETENTION_HOURS` (default 168) and then removed by River's cleaner, so act within that window.

## AedstGoroutinesHigh

**Meaning.** A pod holds more than 10000 goroutines for 15 minutes.
Usually requests stuck on a slow dependency (check the pool alerts) or a leak. Capture before restarting:
set `config.pprofEnabled: true` (served on the metrics port only, never the public port; needs `metrics.enabled`),
then `kubectl port-forward <pod> 9090` and `curl 'localhost:9090/debug/pprof/goroutine?debug=2'` for the full stacks
(or `/debug/pprof/heap` with `go tool pprof`). Read the stack that repeats, then restart the pod. Turn pprof off again:
profiles expose process internals.

## AedstRateLimiterFailingOpen

**Meaning.** Valkey returned errors for 10 minutes, so every rate-limit decision (per-IP auth, per-user API, the
failed-authentication throttle) was skipped and the request allowed. The API still serves; nothing is limited.
`aedst_ratelimit_fail_open_total` counts the skipped decisions.

**Check.** `kubectl logs` for "rate limiter unavailable, failing open"; Valkey pod health; `AEDST_VALKEY_ADDR`,
the TLS settings (`AEDST_VALKEY_TLS*`) and the password Secret key; the CA file mounted at `tlsCaFile`.

**Act.** Restore Valkey. Nothing needs a redeploy; the limiters recover on their own. If the outage is long and
abuse is visible (`AedstShedding429` quiet while error rates climb), lower `config.maxInFlight` as a stopgap.

## AedstValkeyDegraded

**Meaning.** `aedst_readiness_degraded{check="valkey"}` has been 1 for 10 minutes: the optional dependency fails
its readiness probe, instances stay in rotation in degraded mode. For `database_read` it means reads fall back to the
primary. Usually fires together with `AedstRateLimiterFailingOpen`; this one also covers an idle limiter (no
traffic, so no fail-open counter).

**Act.** Same as above; for `database_read` check the replica and `AEDST_DATABASE_READ_URL`.

## Related non-alerting checks

- **Retention** (`aedst_retention_purged_total`, `retention: purged rows` logs): idempotency keys, notifications, audit entries, search tombstones and dead sessions are purged hourly by River periodic jobs; finished River jobs (event deliveries) by River's own cleaner. If table sizes keep growing, look for failed `platform.retention` jobs: `SELECT state, count(*) FROM river_job WHERE kind = 'platform.retention' GROUP BY 1;`
- **Valkey down**: `/readyz` reports `degraded`, limiters fail open, one warning per 30 s is logged. Restore Valkey; nothing needs to be redeployed.

## Play Integrity verification

`IntegrityService/VerifyIntegrityToken` (module `integrity`, [modules](/server/modules#integrity), ADR
`apps/server/docs/adr/0018-play-integrity-verification.md`) is **off by default**: while
`AEDST_INTEGRITY_ENABLED=false` it answers `FAILED_PRECONDITION` ("not configured") and nothing is contacted or
required at startup.

**Setup (UNVERIFIED against the real Google API; follow Google's current Play Console docs).**

1. Play Console: App integrity, link a Google Cloud project to the app; use the same project **number** as
   `PlayIntegrityCloudProject` in the Android app.
2. In that Cloud project enable the **Play Integrity API**. Standard-request responses are decrypted by Google, so the
   server holds no response-encryption keys; it only calls `decodeIntegrityToken` with a Google credential.
3. Credential: a service-account key of that project (`AEDST_INTEGRITY_CREDENTIALS_FILE` or `_JSON`), or leave both
   empty and use Application Default Credentials (workload identity, `GOOGLE_APPLICATION_CREDENTIALS`).
4. Set `AEDST_INTEGRITY_ENABLED=true` and `AEDST_INTEGRITY_ALLOWED_PACKAGES=com.aedst.android` (add the `.debug`
   applicationId only where needed). Other knobs and defaults: `apps/server/.env.example`.
   Apply the `integrity` migration first (`task migrate`; the Helm migration job takes its module list from
   `migrations.modules` in the chart values, which must include `integrity`).

**Android mapping.** `PlayIntegrityFacade.requestIntegrityToken(requestHash)` must be called with
`request_hash = base64url_nopad(SHA-256("aedst.integrity.v1\n" + action + "\n" + payload))` where `action` is a
lowercase name (`login`, `purchase`) and `payload` is the bytes the token is bound to (a request digest plus a fresh
random nonce; never reuse). The app then sends token, action, payload, `request_hash` and its `package_name` to the RPC
with its normal bearer token. Example vector: action `login`, payload `nonce-1` hashes to
`UkAvAJYvJMZg2YwnrmEJU958ycebRjwq-tR0Fxs6at8`.

**Reading results.** `verified=false` with `reason`: `request_hash_mismatch` (client bug), `token_not_bound` (token
minted for another request), `token_expired` (older than `AEDST_INTEGRITY_MAX_TOKEN_AGE_SECONDS`),
`token_replayed`, `device_not_trusted` (below `AEDST_INTEGRITY_MIN_DEVICE_LEVEL`; emulators never count),
`app_not_recognized` (sideload or wrong signing cert; relax with `AEDST_INTEGRITY_REQUIRE_PLAY_RECOGNIZED=false` for
internal builds), `token_undecodable` (Google answered 400). An `INTERNAL` error means an operational failure (Google
403 = API disabled or wrong project/credential, 429 = quota, 5xx, database); the cause is in the server log with the
trace id and never contains the token. Google's default quota is 10,000 decode calls per day for the project: watch
for `RESOURCE_EXHAUSTED` from the per-user limit and request a quota increase before enabling it for all users.

## Removing first-party auth (ADR-0019)

The server no longer authenticates anyone itself: `AuthService`, argon2id passwords,
HS256 session tokens, `AEDST_AUTH_FIRST_PARTY_*`, `AEDST_JWT_*`, the token TTLs,
`AEDST_LOGIN_RATE_LIMIT_PER_MINUTE` and `AEDST_RETENTION_SESSION_HOURS` are gone, and
`AEDST_OIDC_ISSUER` / `AEDST_OIDC_AUDIENCE` are required. `AdminService.ListUsers` is
gone too (the user directory is the IdP's). Migration `auth/00004` drops
`auth.sessions` and `auth.credentials` and the `auth` schema.

Cutover for a deployment that has first-party users (a deployment without users can skip
steps 2 and 3):

- [ ] 1. ZITADEL (or the chosen IdP) is live; `AEDST_OIDC_*` set; roles `admin`/`user` granted on the project.
- [ ] 2. Import the users **before** the new server version migrates: `deployments/zitadel/import-users.sh`
  imports `auth.credentials` with the existing UUID as the user id (so `ids.FromExternal` keeps every row
  keyed by the old id attached) and the existing password hash. See "Password hash import (ZITADEL)".
- [ ] 3. Take a database backup. Migration `auth/00004` is irreversible for the data: its Down only recreates empty tables.
- [ ] 4. Clients (web, Android, Apple, Desktop) sign in with Authorization Code + PKCE and no longer call `AuthService`; raise
  `AEDST_MIN_CLIENT_VERSIONS` to the first IdP-only release before rolling the server, because those RPCs no longer exist.
- [ ] 5. Roll the server (the migration Job runs `auth/00004`). Remove the old settings from your overlays and secrets
  (`jwt-signing-key` is no longer read).

### Password hash import (ZITADEL)

Importing hashes lets users keep their passwords, so the first-party path can be
deleted before the sunset date instead of waiting for every user to log in once.

- **API.** ZITADEL's v2 user API (`POST /v2/users/human`) takes an optional
  `userId` and a `hashedPassword` `{hash, changeRequired}`; the hash is an encoded
  string in Modular Crypt Format, at most 200 characters. **Verified in ZITADEL's
  source (main, 2026-10-08):** the proto definitions say so, and
  `internal/crypto/passwap.go` wires verifiers for argon2 (argon2i/argon2id),
  bcrypt, scrypt, pbkdf2, sha2, md5 variants, phpass and drupal7, with cost bounds
  for imported hashes in `SystemDefaults.PasswordHasher.Limits` (defaults: bcrypt
  cost 10-16; argon2 time 1-10, memory 8192-524288 KiB, threads 1-16). ZITADEL's
  public docs do not list the accepted encodings, hence the source check.
- **Our hashes.** Argon2id in PHC format
  (`$argon2id$v=19$m=65536,t=3,p=4$<salt>$<hash>`) and bcrypt (`$2a$`/`$2b$`) are
  both inside those default bounds.
- **Verified on 2026-10-08 against ZITADEL v4.19.4** (release binary + Postgres 17; evidence in
  `apps/server/deployments/zitadel/README.md`, "Verification log"): both an argon2id hash
  as the server writes it (m=65536,t=3,p=4) and a bcrypt `$2a$` hash import, the session API
  accepts the old password and rejects a wrong one, and the migrated user completes code+PKCE
  with `sub` equal to the old UUID. **Prerequisite:** start ZITADEL with
  `ZITADEL_SYSTEMDEFAULTS_PASSWORDHASHER_VERIFIERS=argon2,bcrypt` (YAML:
  `SystemDefaults.PasswordHasher.Verifiers`); by default only the active hasher (bcrypt) is
  accepted and an argon2id import fails with 400 `CRYPT-r8Qm2` ("passwap: not a bcrypt
  version"). The compose `idp` profile sets it; the Helm example sets it too (chart rendering
  UNVERIFIED). Still rehearse on a throwaway instance with a copy of the real data before a
  production run.
- **Script.** `apps/server/deployments/zitadel/import-users.sh [--dry-run]` reads
  `auth.credentials`, creates each missing user (idempotent, existing ids are
  skipped) with `userId` = the old UUID, the hash, and the `user` role grant, and
  prints counts. Emails default to unverified (`ZITADEL_IMPORT_EMAIL_VERIFIED`).
  Run it from a trusted host: it handles password hashes (nothing is written to
  disk). Roles other than `user` (e.g. `admin`) must be granted afterwards.
- If the rehearsal fails, fall back to inviting users with a password-reset mail.

## Restore, PITR and failover

Postgres runs as a CloudNativePG cluster (3 instances, one synchronous replica,
continuous WAL archiving, nightly base backup; see [deployment](/server/deployment#high-availability-postgresql)).
These are the three situations and what to do. Manifests: `apps/server/deployments/k8s/postgres`.

| Situation | Action | RPO | RTO |
|---|---|---|---|
| Primary pod or node lost | Nothing: CloudNativePG promotes the synchronous replica. Watch `AedstDBPoolWaiting`; pods reconnect through the pooler/`-rw` service | 0 (a commit is acknowledged only with a standby) | seconds to a few minutes (to confirm in the failover drill) |
| Bad migration, accidental `DELETE`, corruption | **PITR** into a new cluster (below), validate, then cut over or copy the rows back | up to the last archived WAL (bounded by `archive_timeout`, CloudNativePG default 5 min; UNVERIFIED for this operator version) | restore time grows with size: **measure it in the drill** and write the number here |
| Cluster or region lost | Same restore from the object store into a cluster elsewhere; repoint `database-url`/`database-direct-url` in the Secret | same as PITR | same as PITR plus DNS/Secret rollout |

RPO and RTO are targets until a drill has measured them: do not quote them externally before then.

### Failover (planned or drill)

```bash
kubectl cnpg status aedst-pg -n aedst-prod            # who is primary, replication lag
kubectl cnpg promote aedst-pg aedst-pg-2 -n aedst-prod # switchover to a chosen replica
```

Expected: a brief write pause, `/readyz` stays green (it checks reachability, not the role), River
reconnects (leader election moves), no event is lost (they are `river_job` rows in the same database).
After a failover check `AedstEventDeliveryFailing` and `AedstJobsLagging` for ten minutes.

### Restore / point-in-time recovery

1. Pick the target: the moment just before the bad change (UTC), from logs or `admin.audit_log`.
2. Copy `deployments/k8s/postgres/recovery.example.yaml`, set `recoveryTarget.targetTime` and the
   namespace, and apply it. It creates `aedst-pg-restore` from the object store through the Barman
   Cloud Plugin (`externalClusters[].plugin`, `barmanObjectName` = the source `ObjectStore`); it
   writes its own backups to a separate `ObjectStore`, never into the source's Barman path. The
   source `ObjectStore` and its credentials Secret must exist in the target namespace. Check the
   plugin is healthy first (`kubectl get deploy barman-cloud -n cnpg-system`). Never verified
   against a cluster: the first drill is the acceptance test.
3. Wait for `kubectl get cluster aedst-pg-restore` to report healthy; recovery replays WAL up to
   the target. Check progress with `kubectl logs` of the recovery pod.
4. Validate: row counts of `tasks.tasks`, `auth.credentials`, the latest `goose_*` versions, and that
   `river_job` has no `running` rows older than the target (they were in flight at the target time;
   River rescues or retries them once workers start).
5. Either **copy the missing rows** back into production (preferred for a narrow mistake), or
   **cut over**: point the `database-url`/`database-direct-url` Secret keys at
   `aedst-pg-restore-rw`/the new pooler and roll the pods; keep the damaged cluster until the new
   one is verified. Then create the nightly `ScheduledBackup` (`method: plugin`) for the new cluster.
6. Event consumers are at-least-once and idempotent, so rows replayed from `river_job` after a
   restore are safe; consumers that had already run for events newer than the target will see the
   same state again.

### Drill cadence

| Drill | When | Done when |
|---|---|---|
| Restore into a scratch namespace and run the smoke tests against it | quarterly, and after every Postgres major upgrade | the cluster is healthy, a representative query set matches, the elapsed time is recorded here |
| Planned switchover (`kubectl cnpg promote`) | twice a year | no failed request outside the pause; recorded time |

Alerts that tell you the plan is at risk: `AedstPgBackupTooOld`, `AedstPgBackupFailed`,
`AedstPgWalArchivingFailing` (PrometheusRule `aedst-pg-backups`, deployed with the cluster).

### Object storage for media

`AEDST_STORAGE_BUCKET` holds user uploads; the database holds only their metadata, so a Postgres
restore does not bring a deleted object back. Enable **bucket versioning** and a **lifecycle rule**
(expire noncurrent versions after 30 days, abort incomplete multipart uploads after 7 days), and
keep the backup bucket (`aedst-pg-backups`) separate, with its own credentials and versioning.
