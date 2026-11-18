# apps/server — AI agent instructions

Read the root [AGENTS.md](../../AGENTS.md) and [CONVENTIONS.md](../../CONVENTIONS.md) first —
this file only adds what's specific to the Go server.

## Before writing a spec-worthy change

A new feature, a new event, or a new command that mutates state should have
a spec under `specs/<module>/<feature>.md` (copy `specs/_template.md`)
**before** implementation — see `.claude/skills/write-spec` if present, or
just fill the template by hand. A one-line bug fix doesn't need one.

## Module boundary rules (enforced, not just documented)

- A module (`internal/modules/<name>/`) is layered
  `domain → application (ports.go + service.go) → infrastructure`, and `transport → api → application`.
  `domain` depends on nothing but stdlib and `internal/shared/**`.
- Another module is only ever reached through its `api/` package. Direct
  imports of another module's `domain`/`application`/`infrastructure`/`transport`
  are a build-breaking violation — enforced by both `.golangci.yml`'s
  `depguard` rules and `architecturetest/boundaries_test.go` (`task arch`).
- `internal/platform/**` never imports `internal/modules/**` — modules depend
  on platform, never the reverse.
- `transport` imports only its own `api/` (plus `platform` and `shared`), never `application` or `domain`; `api/` re-exports the vocabulary transport needs. `cmd/**` imports a module only through `internal/modules/<name>/module`. Only `admin` calls another module's `*Tx` api method.
- Every library/boundary rule is a gate with a negative self-test; the table is in `docs/content/library-first/server.md` ("Enforcement"). Time comes from `sharedtime.Clock`, SQL only from sqlc (no string literals in `Exec`/`Query`), new direct dependencies go in `architecturetest/approved_modules.txt` together with the Library-First page.
- Banned dependencies (enforced by `architecturetest` and depguard): NATS or any
  external broker, RedSync/Redlock or any distributed lock in Valkey, competing
  JWT libraries, ORMs. Only `internal/platform/valkey` imports the go-redis client.

## When a change touches state and another system cares

There is exactly one asynchronous mechanism: **River** (ADR-0014). An integration
event is a River job inserted **in the same transaction** as the state change:
call `events.Publisher.Publish(ctx, tx, type, version, partitionKey, payload)`
(`internal/platform/events`) inside the repository's `database.WithTx`; it
inserts one `platform.event_delivery` job per subscribed consumer with
`InsertManyTx` on your `tx` (`river_job` is the outbox: no outbox/inbox table,
relay or in-process bus exists). Never publish outside the transaction, never
from a request handler on its own, and do not add NATS, Kafka or RabbitMQ — a
broker is only for the day a consumer becomes a separate service, and
`events.Publisher` is the seam for it. Deferred or scheduled work of a module's
own is a plain River job of its own kind (`internal/platform/jobs`). See
`internal/modules/tasks/infrastructure/postgres/postgres.go`'s `Complete`
method for the reference implementation.

A producing module's whole wiring is its `Setup` hook (`internal/modules/<name>/module`):
the `events.Publisher` that `cmd/server` builds is `env.Publisher` there, passed to the
repository as its `EventWriter`. A transition that publishes an event must be **guarded in SQL**
(`UPDATE … WHERE status <> 'done' RETURNING …`; no row → return the current
state, publish nothing), otherwise a retry mints a second `event_id` and every
consumer receives a second delivery. The only shared messaging table left is
`platform.idempotency_keys` (ADR-0012): never create per-module copies.
Domain and application code never import `platform/events` (enforced by
`architecturetest`): publish from `infrastructure/postgres`, subscribe from
`infrastructure/events`.

## When a change reacts to another module's event

Copy `internal/modules/notifications`: subscribe in `infrastructure/events` with
`registry.Subscribe(eventType, "<module>.<consumer>", handler)`, import the
publisher **only through its `api/` package** (the event type and payload struct
live in `modules/<producer>/api/events.go`), and make the handler **idempotent**:
delivery is at-least-once (River retries with backoff, then discards; there is no
inbox table). Key the effect on the event id (`UNIQUE source_event_id`) or use a
version-guarded upsert, run it in one transaction on the **jobs pool**, and store
your own projection in your own schema. Consumer names are stored in job args:
never rename one. Events only gain fields within a version; a breaking change is
a new `…v2` event published beside the old one. The event must carry what the
consumer needs — never call back into the producer. Test with
`internal/platform/events/eventstest` (real River client) or
`Registry.Dispatch` (synchronous, for replays and unit tests).

## When you add a list that can grow

Keyset pagination, never `OFFSET` (`internal/shared/pagination`; reference:
`modules/tasks` `ListTasks*` queries and `modules/notifications` `List`): order
by `(sort_key, id)`, fetch `limit+1`, index `(user_id, sort_key, id)` with all
columns in one direction, no `count(*)` on the paging path. Filters that are
Go string types go to SQL as `text[]` and are cast there (pgx cannot encode
enum arrays). Substring search uses `pg_trgm` indexes; escape LIKE
metacharacters. Indexes on existing tables are created `CONCURRENTLY` in a
`-- +goose no transaction` migration, each preceded by `DROP INDEX CONCURRENTLY IF EXISTS` of the
same name in the same file: a failed concurrent build leaves an INVALID index that `IF NOT EXISTS`
would keep. The migration Job and `task migrate` finish with `scripts/check-invalid-indexes`, which
fails on any `NOT indisvalid` index.

## Adding or wiring a module

`cmd/server` names no module. A module registers itself from
`internal/modules/<name>/module` (`modulekit.Register`: `Name`, `Requires`, `Setup`,
`Mount`, `Retention`, `Files`, `Public`, `Roles`) and gets **one blank-import line** in
`cmd/server/modules.go`. Other modules' services arrive through `modulekit.Require[api.X]`
(never an import of their `application`). `architecturetest` fails when a module directory
has no registration or is not imported there. Details: `docs/content/server/architecture.md`
("Module registry"). Lag-tolerant reads (projections) may use `env.ReadPool`
(`AEDST_DATABASE_READ_URL`, falls back to the primary); anything that writes, or reads its
own write, uses `env.Pool`.

## Connection pools

Two pools: `api` (requests; event `InsertTx` rides its transactions) and `jobs` (River, event consumers), plus an optional `read` pool (`AEDST_DATABASE_READ_URL`, lag-tolerant reads only).
Code that runs in a background worker or an event subscriber must use the jobs
pool; request handlers use the api pool. Keep
`replicas × (MAX_CONNS + JOBS_MAX_CONNS)` under Postgres `max_connections`.
With `AEDST_DATABASE_POOLER=pgbouncer` the api pool is forced to pgx CacheDescribe and startup requires `AEDST_DATABASE_DIRECT_DSN` or `AEDST_JOBS_POLL_ONLY=true`; session-scoped features (`lock.Locker`, LISTEN/NOTIFY) only take a `database.DirectPool`, never the api pool. See `docs/content/server/scaling.md`.

## When you need mutual exclusion

Use PostgreSQL advisory locks via `internal/platform/lock` (`TryXact` inside a
transaction is preferred; `Locker` for session locks). Never a Redis/Valkey
lock. For leader-only periodic work, River's own leader election/unique jobs.

## When you need cache or rate limiting

Valkey through `internal/platform/valkey` (`RateLimiter`). Rate limiting fails
open by design; never put correctness (locks, dedup, queues) in Valkey.

## Authentication

Handlers never verify tokens: `httpserver.AuthInterceptor` does, through
`platformauth.Verifier` (the OIDC resource-server verifier, ADR-0017 and
ADR-0019). Read the caller with `platformauth.FromContext`. The server has no
`auth` module and issues no tokens: do not add a second token format, password
hashing or session storage, and do not verify JWTs anywhere else; identity
features (sign-in, MFA, recovery, the user directory) belong in the IdP.

## Observability

OpenTelemetry only (`internal/platform/observability`): use `otel.Tracer`/
`otel.Meter` and `slog` with the request context (trace_id is added
automatically). Do not add Prometheus-specific instrumentation, per-vendor
SDKs or a second logger.

## Migrations

Every SQL change needs a goose migration that passes `task lint:migrations`
(squawk). Use `-- +goose NO TRANSACTION` for `CREATE INDEX CONCURRENTLY`.
Run `task gen` after touching `sql/` or `api/proto/`.

Closed sets of values (status, kind, priority) are `TEXT NOT NULL` with a named `CHECK`
constraint, **not** PostgreSQL `ENUM` types: an ENUM cannot lose a value, `ALTER TYPE ... ADD
VALUE` has transaction caveats, and pgx cannot bind enum arrays. Adding a value to a `CHECK` is
`DROP CONSTRAINT` + `ADD CONSTRAINT ... NOT VALID` + `VALIDATE CONSTRAINT` in a later migration.
(`tasks.status` and `tasks.priority` are legacy ENUMs; convert them only when a value is added or removed.)
A constraint added to a table that already holds rows follows the same `NOT VALID` then `VALIDATE`
two-step; a brand-new table declares its constraints inline.

## When a command should be safe to retry

Wrap it with `internal/platform/idempotency`: extract the key via
`idempotency.KeyFromContext` in the transport handler, pass it down as an
explicit argument (never read context inside `application`/`domain`), and
call `idempotency.Check`/`Save` inside the same transaction as the write —
see `Repository.Create` in the same file for the reference implementation.
The **scope** you pass (`"<module>:<user id>"`) namespaces the key per caller;
`Check` takes an advisory lock on `(scope, key)`, which is what makes two racing
requests with one key execute once. Hash only the client-supplied fields, never
generated ids or timestamps. Keys are purged by retention after
`AEDST_RETENTION_IDEMPOTENCY_HOURS`.
Every write RPC a client may queue in its offline outbox (the clients send the outbox item
id as `Idempotency-Key`) must be replay-safe: `CreateTask`, `UpdateTask` and `DeleteTask`
carry the key through Check/Save in the write's transaction (replay returns the first
result; reusing a key for a different request is a Conflict); `CompleteTask`/`ReopenTask`
are idempotent by their guarded SQL. A new queued write needs the same plus a replay test
(`write_idempotency_integration_test.go`, `TestServer_QueuedWritesAreReplaySafe`).

## When a command edits data users can edit concurrently

One statement, not read-modify-write: `COALESCE(sqlc.narg(x), x)` per column plus
`version = version + 1`, and an optional `expected_version` predicate
(`Repository.Update`). No row back → one follow-up read to tell `NotFound` from a
stale version (`Conflict` → `ABORTED`). Validation lives in `domain` (`NewTask`,
`Patch.Normalize`), never only in the transport or protovalidate. Work that must
not be lost when the change commits (a reminder job) is enqueued in the same
transaction (`client.InsertTx`, unique by args), not after it.

## When a table only grows

Ship a `retention.Policy` with it (`internal/platform/retention`; return it from the
module's `Retention` hook) and an index on the timestamp it purges by, created `CONCURRENTLY`.
The purge function deletes at most `limit` rows and returns the count.

## Errors, logging and protection

Return domain errors through `httpserver.ToConnectError`; anything unclassified
becomes a generic `CodeInternal` whose real cause `httpserver.ErrorLogInterceptor`
logs and records on the span — do not log-and-return in handlers. Role checks go
in `AEDST_ROLE_POLICY` (`/aedst.tasks.v1.TasksService/DeleteTask=admin|support`,
enforced by `httpserver.RoleInterceptor`), not in handler code. The policy is
validated at startup against the procedures in the protobuf descriptors: an
unknown or public procedure fails the deploy. A new service is mounted ONLY with
`modulekit.Mount(mounter, xv1connect.RegisterXServiceHandler, impl, maxBytes)` (`internal/platform/modulekit/mount.go`), called from the module's `Mount` hook (`internal/modules/<name>/module`): that
is what guarantees the protovalidate interceptor, the shared chain, the per-service
message cap and the Connect-Protocol-Version requirement — architecturetest's
`TestEveryConnectHandlerIsMountedThroughTheMounter` fails on a direct
`Register*ServiceHandler` call (or a `connect.NewServer` in a module) or an RPC passed to `router.Handle`. Add its file
descriptor in the module's `Files` too (startup fails otherwise); after that an
admin-only RPC needs no wiring change, only an entry in the deployment's
environment. `"/pkg.Service/*=role"` covers a whole service (an exact entry wins);
the built-in default `/aedst.admin.v1.AdminService/*=admin` keeps operator RPCs
closed when `AEDST_ROLE_POLICY` is empty. The server runs connect-go **v2**
(`connectrpc.com/connect/v2`): handlers take and return plain messages, request
headers and the peer come from `connect.CallInfoForServerContext`, errors carry no
metadata (set `Retry-After` on the response header), and interceptors are
`connect.ServerInterceptor`s that wrap every RPC shape, streaming included. Every authenticated
RPC is already covered by the per-user rate limit
(`AEDST_API_RATE_LIMIT_PER_MINUTE`) and every request by load shedding
(`AEDST_MAX_IN_FLIGHT`); a limiter outage fails open and must stay that way.
Valkey is optional: never add it to a required readiness check or a startup step.

## Before opening a PR

Run `task check` (gen:check, lint incl. `sqlc vet`, arch, vuln, unit tests (CI adds `-race`) — the
same gate CI runs). `task check:full` additionally runs Docker-dependent gates
(migration linting, integration tests) locally.

## Operator (admin) mutations

The admin module is the one sanctioned exception to "transactions never span
modules": it opens the transaction, passes the `pgx.Tx` to the owning module's
`*Tx` api method (`tasks/api.AdminService.DeleteTaskTx`,
`notifications/api.Broadcaster.BroadcastTx`) and writes `admin.audit_log` in the
same transaction. Only admin may call `*Tx` api methods; the owning module still
writes its own rows and publishes its own events.

When the target module is **not** hosted in this process admin cannot pass it a transaction: it
writes the audit entry as `pending` plus an `admin.apply` job, and the job calls the owner's
network-safe operator service (`tasks/api.OperatorService`, `notifications/api.Operator`)
idempotently on the entry id (`admin/application/audit_first.go`, `apply.go`). Never add a `*Tx`
method to an api that another process may need to call; give the owner an idempotent operator
method instead. `admin.audit_log` rows may leave `pending` once, through `ResolveAuditEntry` only.

## Background queues and heavy work

River queues: `default` (light jobs) and `media` (image/ffmpeg processing).
`AEDST_JOBS_QUEUES` decides which queues a process works (`default=50,media=2`
by default; empty = insert-only). Helm: `jobs.queues` sets it for the API, and
each `workers:` entry renders its own Deployment with its own `queues`,
`replicas` and `resources` (prod: API `default=50`, worker `media=4`). Every
process registers every worker
(River validates job kinds on insert). Object storage goes only through
`internal/platform/storage`; push providers only through `internal/platform/push`, which wraps the libraries
`webpush-go`, Firebase Admin Go (`messaging`) and `apns2` — never hand-write ECE,
VAPID/APNs JWTs or FCM OAuth.

## Images (govips + imgproxy)

Image ingest goes only through `processing.ImageProcessor` (govips/libvips,
`images_vips.go`, build tag `vips`; `images_novips.go` is the stub for default
builds, so unit tests use a fake). It sanitizes the ORIGINAL only: pixel limit
from the header, auto-orient, EXIF/GPS strip, canonical encode. Do not add
thumbnails/previews/format conversions there: sizes and WebP/AVIF are imgproxy's
job (`internal/platform/imgproxy` signs URLs; presets in `imgproxy.PresetsEnv`).
Never run the same operation in both stages, never import `golang.org/x/image`.
The vips path needs cgo + libvips: `task test:vips` / `task build:vips` (CI job
`unit-vips`); it cannot compile on a `CGO_ENABLED=0` machine. See ADR-0015.
