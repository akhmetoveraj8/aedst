---
title: "Deployment"
description: "apps/server/deployments/docker/docker-compose.yml runs PostgreSQL 18 and DragonflyDB (the only services aedst-server needs). Optional compose profiles add..."
---

# Deployment

## Local development

`apps/server/deployments/docker/docker-compose.yml` runs PostgreSQL 18 and DragonflyDB
(the only services `aedst-server` needs). Optional compose profiles add
observability (`observability`), a ZITADEL OIDC provider (`idp`) and PgBouncer
(`pgbouncer`, transaction pooling on `localhost:6432`) for rehearsing the production
connection path. The `observability` profile is a single `grafana/otel-lgtm` container (OTLP in). NATS JetStream
is optional and only feeds the Rust realtime gateway (`AEDST_NATS_URL`, [ADR-0021](../../../apps/server/docs/adr/0021-nats-jetstream-and-rust-gateway.md)); asynchronous work (jobs and integration events) runs on River,
with events inserted as River jobs in the producer's transaction
(see [events](/server/events) and [ADR-0014](/decisions/0014-river-insert-tx-as-outbox)).
`task dev` (in `apps/server`) starts the stack, applies migrations and runs the
server. See the [server README](../../../apps/server/README.md).

## Scalability principles

These are baked into `internal/platform/*` and every module must preserve them:

- **Stateless processes**: no in-process session or request state; any replica can
  serve any request, so horizontal scaling is just more pods.
- **Idempotent handlers**: commands accept an `Idempotency-Key` and dedupe in the
  same transaction as the write (`platform/idempotency`); event consumers are idempotent
  (River delivers at-least-once, `platform/events`).
- **Transactional events**: state changes and the events they cause commit together (River `InsertTx`);
  River delivers afterwards (`platform/events`), so no dual writes.
- **Bounded pools**: the API DB pool (`AEDST_DATABASE_MAX_CONNS`) and the background
  jobs pool (`AEDST_DATABASE_JOBS_MAX_CONNS`) are limited per pod so replicas x pool
  size stays under Postgres/PgBouncer capacity and background work cannot starve
  the API.
- **Graceful shutdown**: on SIGTERM `/readyz` returns 503 first
  (`AEDST_SHUTDOWN_DRAIN_SECONDS`), then the listener stops and in-flight requests
  finish (`AEDST_SHUTDOWN_TIMEOUT_SECONDS`).
- **Configuration via environment only** (`platform/config`, `caarlos0/env`): the
  same image runs in every environment and startup fails fast on invalid config.

Related decisions: [ADR-0008 realtime and media](/decisions/0008-realtime-and-media-extraction),
[ADR-0009 API compatibility and client versioning](/decisions/0009-api-compatibility-and-client-versioning),
[ADR-0010 caching and data partitioning](/decisions/0010-caching-and-data-partitioning).

## Target production architecture

```
                 Cloudflare
                     |
               Envoy / Ingress
                     |
              ConnectRPC / API
                     |
       AEDST Modular Monolith (Kubernetes Deployment)
                     |
       +-------------+-------------+
       |                           |
  PostgreSQL                    DragonflyDB
  (via PgBouncer,               (managed)
   + direct connection
   for jobs/locks)
```

### Status

| Item | Status |
| --- | --- |
| Dockerfile (`deployments/docker/Dockerfile`: Debian 13 trixie, cgo + `-tags vips`, libvips runtime, nonroot; no longer distroless) | Written, **not built** where authored (CI `docker-build` is the test) |
| imgproxy (compose profile `media`; Helm `imgproxy.enabled`, Deployment + Service + NetworkPolicy; [ADR-0015](/decisions/0015-govips-and-imgproxy-media-pipeline)) | Written, **not run / not rendered** where authored |
| Migration image (`deployments/docker/Dockerfile.migrate`, goose) | Implemented |
| Helm chart `apps/server/deployments/helm/aedst-server` | Implemented (not yet linted in CI) |
| PgBouncer compose profile for local rehearsal | Implemented |
| OpenTofu modules (single IaC tool, [decisions](/decisions)) | Not implemented |
| Argo CD | Not implemented |
| GitHub Actions deploy pipeline | Not implemented |
| Realtime (ADR-0008, proposed) | Not implemented; media runs in-process on its own River queue |

### Helm chart

One chart with `values-{dev,staging,prod}.yaml` overlays:

```bash
helm upgrade --install aedst-server apps/server/deployments/helm/aedst-server \
  -n aedst -f apps/server/deployments/helm/aedst-server/values-prod.yaml \
  --set image.tag=<git-sha>
```

- `Deployment` (rolling update, zero unavailable, topology spread over zones and
  nodes, read-only root filesystem, non-root), `Service`, `ConfigMap`, `HPA`
  (`autoscaling/v2`, CPU and memory), `PodDisruptionBudget`, `ServiceAccount`, and
  an optional `ServiceMonitor`.
- Liveness probes `/livez`, readiness probes `/readyz`. No `preStop` hook is used:
  the server fails readiness first on SIGTERM.
  `terminationGracePeriodSeconds` is computed as drain + shutdown timeout + 10s and
  the render fails if an override is not larger than drain + timeout.
- **Secrets are never in values.** `existingSecret` names a Secret provisioned
  elsewhere; the chart references its keys for the DSNs, the JWT signing key, the
  DragonflyDB password and the optional storage/push/integrity credentials
  (`secretKeys.*`, all listed in `deployments/secrets/secrets.example.yaml`). The shipped
  bridge is SOPS+age decrypted by **ksops** in the Argo CD repo-server
  (`deployments/k8s/secrets/overlays/<env>`, one `aedst-secrets-<env>` Application each; setup in
  `deployments/secrets/README.md`). External Secrets Operator is the alternative if a cloud
  secret store is adopted: render an `ExternalSecret` with the same name and keys.
- **Every setting is a value.** A test (`internal/platform/config/documented_test.go`) fails when an
  `env:` tag of `config.Config` is missing from `.env.example` or from the chart templates;
  `values.schema.json` rejects unknown keys under `config`, `jobs` and `workers`; the generated
  [configuration reference](/server/config) lists every variable (`task docs:config`).
- **Image tags are explicit.** `image.tag` has no default; the Argo CD Applications carry
  `helm.parameters: image.tag` per environment, and the server and migrate images share the tag.
- **Worker Deployments.** `jobs.queues` renders `AEDST_JOBS_QUEUES` for the API; the `workers:`
  list renders one extra Deployment per entry (same image, ConfigMap and Secret; no Service, no
  migration hook, own queues/replicas/resources). `values-prod.yaml` runs the API on `default=50`
  and a `media=4` worker. Worker pods are scraped through the pod annotations, not the
  ServiceMonitor. Autoscaling a worker on queue age (KEDA `ScaledObject` on
  `aedst_river_oldest_available_age_seconds`) is a documented follow-up, not shipped.
- A **migration Job** runs as a `pre-install,pre-upgrade` Helm hook and applies goose
  migrations for every module before new pods roll out. It uses the direct DSN when
  configured, runs `check-invalid-indexes` afterwards (fails on any `NOT indisvalid` index left by a failed
  `CREATE INDEX CONCURRENTLY`), and has a per-environment `migrations.activeDeadlineSeconds`.
- **Migration history is squashed (2026-10-09).** `tasks`, `notifications` and `platform` each start at
  one `00001` that creates only the final schema: the relay-era outbox/inbox tables and the
  create-then-drop steps are gone (the end state was verified identical by diffing the catalog of
  both histories: columns, constraints, indexes, triggers, functions, enums). This is safe only
  because no database ever applied the old files. **A database that did must be recreated or
  re-baselined by hand (drop the `goose_<module>` tables after verifying its schema); do not run
  the new files over it.** From now on migrations are append-only: a released migration is never
  edited.

### PgBouncer and the database

- In production `AEDST_DATABASE_URL` should point at a **transaction-pooling
  PgBouncer**: on Kubernetes the CloudNativePG `Pooler` resource
  (`deployments/k8s/postgres/base/cluster.yaml`, declarative, operator-managed - the
  Helm chart ships no PgBouncer image); the standalone `edoburu/pgbouncer` image
  exists **only** in Docker Compose for local rehearsal.
- Declare it with `AEDST_DATABASE_POOLER=pgbouncer` (Helm: `database.pooler`).
  The API pool is then **forced** onto pgx `QueryExecModeCacheDescribe`
  whatever the DSN says (no named prepared statements, so no `prepared statement
  ... does not exist` when a transaction lands on another server connection), and
  `statement_timeout` / `idle_in_transaction_session_timeout` are no longer sent
  as startup parameters (PgBouncer would ignore or reject them): they live on the
  database role (`ALTER ROLE aedst SET statement_timeout = '15s'`, done in
  `cluster.yaml`'s `postInitApplicationSQL`). The pooler also sets
  `max_prepared_statements` (200; PgBouncer >= 1.21) as a safety net for clients
  that do use protocol-level prepared statements.
- **The identity provider is not an app client of the Pooler.** ZITADEL (ADR-0001)
  may share the CloudNativePG cluster, but only with its own database and role
  (`cluster.yaml`: managed role `zitadel` plus a `Database` resource, no shared
  schemas), connecting straight to `aedst-pg-rw:5432` - never to
  `aedst-pg-pooler-rw`, which is transaction-mode and sized for the API pool. If it
  ever needs pooling, give it a separate session-mode Pooler. Its connections
  count against `max_connections`. See `deployments/zitadel/helm-values.example.yaml`.
- **Startup refuses an unsafe topology.** With `AEDST_DATABASE_POOLER=pgbouncer`
  config validation requires `AEDST_DATABASE_DIRECT_DSN` (River and anything
  session-scoped on a direct connection) **or** `AEDST_JOBS_POLL_ONLY=true`
  (River without LISTEN/NOTIFY: pickup and leader election by polling, slower
  and chattier). A direct DSN is the default choice.
- **River's LISTEN/NOTIFY** does not work through transaction pooling. The jobs
  pool therefore uses `AEDST_DATABASE_DIRECT_DSN` (Helm
  `database.directDsnSecretKey`); a request-side `InsertTx` still rides the
  request transaction on the API pool, which is fine (it is plain SQL).
- **Session advisory locks** leak onto whichever server connection served that
  transaction. Through the pooler use only `lock.TryXact`/`lock.Xact`
  (`pg_advisory_xact_lock`, released at COMMIT/ROLLBACK; the idempotency store does
  this). `lock.Locker` (session locks, for long-held leader-style work) can
  only be built from a `database.DirectPool` (`database.NewDirectPool` refuses a
  `pgbouncer` config), so it cannot be handed the API pool by accident.
  Migrations use the direct DSN too.
- Size pools: see [scaling.md](/server/scaling#pooler-sizing-replicas-vs-pgbouncer).

### High-availability PostgreSQL

`apps/server/deployments/k8s/postgres/` is a Kustomize base (`base/cluster.yaml`) plus one overlay
per environment (`overlays/staging`, `overlays/prod`: namespace, backup `destinationPath` and
`serverName`, backup-credentials Secret, sizing); each Argo CD Application points at its own
overlay, so staging can never archive WAL into the production bucket path. The base is a
[CloudNativePG](https://cloudnative-pg.io) `Cluster` (needs CloudNativePG >= 1.26 for the Barman Cloud Plugin and >= 1.25 for the declarative `Database` resource; validated offline against the v1.30.1 CRDs, with unknown fields rejected) — cloud-agnostic, runs on any conformant cluster: 3 instances on
different nodes (required anti-affinity, zone spread), **one synchronous replica**
(an acknowledged commit survives losing the primary), automatic failover,
continuous WAL archiving plus a nightly base backup to S3-compatible storage
(point-in-time recovery, 30-day retention), and a 3-replica **PgBouncer `Pooler`**
in transaction mode for the API pool. The jobs pool connects to the cluster
service directly (`AEDST_DATABASE_DIRECT_DSN`). Managed Postgres (RDS, Cloud SQL,
…) is an equally valid choice; the requirements are the same: synchronous
replica, PITR, and a direct (non-pooled) endpoint for the jobs pool.

#### Backups: Barman Cloud Plugin

WAL archiving and base backups use the **Barman Cloud Plugin**
(`plugin.barman-cloud.cloudnative-pg.io`, [docs](https://cloudnative-pg.io/plugin-barman-cloud/)),
not the in-tree `spec.backup.barmanObjectStore`, which is deprecated upstream and which the Cluster
CRD refuses next to an archiver plugin. Pieces:

| Piece | Where |
|---|---|
| `ObjectStore` (`barmancloud.cnpg.io/v1`): `destinationPath`, `s3Credentials`, `wal`/`data` compression, `retentionPolicy` (30d prod, 7d staging) | `base/objectstore.yaml`, per-environment `overlays/<env>/patch-objectstore.yaml` |
| `Cluster.spec.plugins`: `name: barman-cloud.cloudnative-pg.io`, `isWALArchiver: true`, parameters `barmanObjectName` and `serverName` (per environment) | `base/cluster.yaml`, `overlays/<env>/patch-cluster.yaml` |
| `ScheduledBackup` with `method: plugin` and `pluginConfiguration.name` | `base/cluster.yaml` |
| Restore: `bootstrap.recovery.source` plus `externalClusters[].plugin` | `recovery.example.yaml` |

Install once per cluster, in the operator's namespace (`cnpg-system`), after cert-manager:
`kubectl apply -f https://github.com/cloudnative-pg/plugin-barman-cloud/releases/download/v0.15.1/manifest.yaml`.
Requirements: CloudNativePG >= 1.26 (latest operator checked: v1.30.1), cert-manager, plugin v0.15.1
(latest release at time of writing, 2026-09-30; checked on the GitHub releases API). Retention lives on
the `ObjectStore` (the Cluster's `spec.backup.retentionPolicy` only applies to the in-tree method). The
`ObjectStore`'s own `serverName` must stay empty (its CRD rejects it); the server name is the `serverName`
plugin parameter. Argo CD: the AppProject whitelists `barmancloud.cnpg.io/ObjectStore`, and the store
carries sync-wave `-1` so it exists before the Cluster.

**Verification status.** The manifests were checked offline against the upstream CRD schemas (CloudNativePG
v1.30.1 Cluster and ScheduledBackup, plugin v0.15.1 ObjectStore) with a structural check that rejects unknown
fields, and CI runs `kustomize build` plus `kubeconform -strict` and asserts that no `barmanObjectStore`
remains. **Nothing was applied to a cluster**, no backup or restore has run, and these points are
UNVERIFIED: the default `serverName` when the parameter is omitted, whether the `cnpg_collector_*backup*`
alert metrics are populated for plugin backups (see the note in `base/prometheusrule.yaml`), the
Datree CRD catalog schema for `ObjectStore` matching v0.15.1, and the migration of an existing cluster
that already holds in-tree backups (point the plugin at the same `destinationPath` and `serverName` to
keep the archive continuous; confirm in a scratch namespace first). Do the first restore drill before
relying on it.

What this buys, and what it does not: a node or zone loss fails over in seconds
with no committed data lost; a bad migration or `DELETE` is recoverable to the
second. Recovery is only real once **restored**: rehearse a restore into a scratch
namespace (`bootstrap.recovery` from the object store) before relying on it, and
after every major upgrade.

### Transport security and identity

- **Staging and production refuse to start** unless DragonflyDB uses TLS (`config.cache.tls`, with `tlsCaFile`
  and optionally `tlsServerName`; `allowPlaintext` is the explicit opt-out for a trusted segment) and
  every PostgreSQL DSN carries `sslmode=verify-full` (or `verify-ca`) with `sslrootcert` (`database.allowUnverifiedTls`
  is the opt-out). The chart mounts the CloudNativePG CA Secret `<cluster>-ca` and the DragonflyDB CA through
  `extraVolumes`; the CloudNativePG cluster rejects non-TLS TCP (`pg_hba` `hostnossl ... reject`).
- **Access tokens must look like access tokens.** The JOSE `typ` must be one of `config.oidc.tokenTypes`
  (default `at+jwt`, `JWT`); ID, refresh and logout tokens (ID-only claims `nonce`/`at_hash`/`c_hash`, or a
  payload `typ` of ID/Refresh/Offline/Logout) are refused even with the right audience. Confirm what your provider
  sends before the first deploy (UNVERIFIED for ZITADEL and Keycloak: decode one real access token).
- **Rotation is automatic**: a token with an unknown `kid` triggers one JWKS refresh per minute.
- **Failed authentication is throttled per client IP** (`config.authFailRateLimitPerMinute`, default 60): over
  budget the caller gets RESOURCE_EXHAUSTED before token verification. An identity-provider outage is
  UNAVAILABLE (retryable) and is not charged to the caller.
- **Memory and profiles**: `GOMEMLIMIT` is set to 85% of `resources.limits.memory`; `config.pprofEnabled`
  serves `/debug/pprof` on the metrics port (port-forward only).

### GitOps (Argo CD)

`apps/server/deployments/k8s/argocd/applications.yaml` declares an `AppProject`
and one Application per environment: **staging** follows `main` and syncs
automatically (prune and self-heal; the database is never pruned); **prod**
follows a release tag and syncs **manually**, so a person promotes a build after
staging is green. The chart's migration Job runs as a PreSync hook, so
migrations complete before any new pod starts.

### Alerts, dashboard and runbook

The chart ships `PrometheusRule` alerts (`files/alerts.rules.yaml`, native
Prometheus format) and a Grafana dashboard (`files/aedst-server-dashboard.json`),
enabled per environment with `alerts.enabled` / `dashboards.enabled`. Every alert
links to its section of the [runbook](/server/runbook). The alerts cover no-instances,
5xx ratio, p95 latency, throttling/shedding, connection-pool saturation and
waiting, River job lag / growing backlog / failing delivery / **discarded events**
(paged), and goroutine growth — all from the server's own OpenTelemetry metrics.
Optional `networkPolicy` restricts ingress to the ingress controller and egress
to DNS plus what you list (`egressTo` must name Postgres, DragonflyDB, the OTLP
collector and the OIDC provider, which is why it is opt-in).

### Verification status (read this before trusting the manifests)

| Artifact | Verified how |
|---|---|
| Helm chart incl. `PrometheusRule`, dashboard ConfigMap, `NetworkPolicy` | Rendered with the Helm engine (defaults, prod values, and a values file enabling every optional template) |
| Alert expressions | Each PromQL expression parses with Prometheus' own parser; metric names checked against a running server's `/metrics`. **Not** evaluated against real traffic |
| Dashboard | Generated JSON, structure checked; not imported into Grafana |
| CloudNativePG cluster, Argo CD applications | Schema-validated offline against the CloudNativePG v1.30.1 CRDs (all fields, unknown fields rejected); Argo CD applications: YAML syntax and `apiVersion`/`kind` only. **Never applied to a cluster** — run `kubectl apply --dry-run=server` against your operator/Argo versions first; fields marked `CHECK` depend on the operator version |

### Still to do when a real cluster target exists

- **OpenTofu** (the one IaC tool; Terraform is not used, see [decisions](/decisions)): deliberately not written yet. The modules (network,
  managed or self-hosted Postgres, cluster, edge) are a function of the chosen
  cloud, and guessing a provider produces code nobody can apply. Pick the cloud,
  then add one module per concern so each can be recreated independently.
- **Edge**: Cloudflare in front of Envoy/ingress; the app is never exposed directly
  to the internet. Set `AEDST_TRUSTED_PROXY_HOPS` to the real proxy count.
- **A production-shaped load test** ([scaling.md](/server/scaling#load-testing)): the only
  recorded numbers are from one developer machine. Alert thresholds and
  `AEDST_MAX_IN_FLIGHT` should be re-derived from it.
- Realtime (not built) and, if the queue split proves insufficient, media as their own charts: see ADR-0008.
