# Proposals and the decisions taken on them (2026-10-09)

Decided by the owner on 2026-10-09 (they asked for the recommended option in each case): **2** delete
`platform/rpc` (done), **8** `TEXT + CHECK` for new tables (done, `AGENTS.md` "Migrations"), **9** squash
migrations (done, schema diff proved identical). **1, 3, 4, 5, 6** deferred to the first extraction, **7** deferred to an
Android release. The sections below keep the plans for the deferred items; 2, 8 and 9 are historical.

# Original proposals

None of these is implemented. Each one touches a recorded decision (ADR or a row of
`docs/content/decisions/server.md`), so it is a plan with a diff outline and a recommendation,
not code. Reply per item with *approve*, *reject* or *change*. Effort is for one engineer.

Already shipped without a decision (they use seams that exist): worker Deployments from
`workers:`, `Publisher` as an interface, `PoolFor`/`JobsPoolFor`, River migrations in the Job,
HTTPRoute, topology test. See `docs/content/server/runbook-extract-service.md`.

## 1. Event contracts as protobuf (`events.proto`)

**Touches:** ADR-0014 chose JSON structs in each producer's `api/events.go` "until the event crosses a
service boundary".

**Plan.** `api/proto/aedst/tasks/v1/events.proto` (`TaskCompletedEvent`, `TaskSnapshot`,
`TaskDeletedEvent`, `TaskDueSoonEvent`) and `api/proto/aedst/media/v1/events.proto`
(`MediaReadyEvent`, `MediaDeletedEvent`), field for field as today's Go structs (same names and
JSON names). Producers marshal with `protojson` (the JSON on the wire does not change, and the
existing `goldentest` fixtures stay valid), consumers decode with `protojson`. In
`<module>/api/events.go` the Go types become aliases of the generated messages, so in-process code
is unchanged. `buf breaking` then guards event evolution like any other contract.

**Diff outline.** 2 new `.proto` files; `task gen`; `api/events.go` in tasks and media (types -> aliases,
constants stay); `events.Publish`/`Event.Decode` helpers marshal through `protojson` for `proto.Message`
payloads; `SnapshotOf` and the `time.Time` fields become `timestamppb` (RFC 3339 in protojson, equal to
`encoding/json`'s output for UTC times: the golden tests prove it); consumers in notifications and search.

**Risk.** Medium: `protojson` omits zero values and emits `int64` as strings, which differs from
`encoding/json`; the golden fixtures are the safety net and must stay byte-for-byte or be versioned.
**Effort.** 1-2 days. **Recommendation.** Approve, but only when a consumer is actually extracted: until
then the golden fixtures (already enforced by `architecturetest`) give the same wire guarantee at no cost.

## 2. `platform/rpc` for media -> tasks: use it or delete it

**Touches:** nothing recorded; `platform/rpc` and `platform/resilience` are unused today (only tests).

**Option A (use).** `media` narrows to the port `TaskOwnership` (already in `media/application/ports.go`);
`media/infrastructure/tasks` implements it over `tasksv1connect.TasksServiceClient` built on
`rpc.NewInMemoryTransport` in `cmd/server`; add `rpc.ClientInterceptors` (otelconnect client, deadline,
identity: bearer pass-through for user-scoped calls, a client-credentials machine token for internal
calls) and an `internal` role in `RoleInterceptor`; integration test. Cost: an in-process HTTP/2 hop
and a second auth path in a monolith that does not need them yet.
**Option B (delete).** Remove `internal/platform/rpc` and its tests as dead code; the extraction runbook
keeps the design.
**Recommendation.** B now, A together with the first real extraction (YAGNI; the Go `api` call is
already the seam). **Effort.** A 2-3 days, B 1 hour.

## 3. Event queues `events.<module>` and a subscription catalog

**Touches:** ADR-0001 ("one deployable, split only for a measured reason"), ADR-0014 (one queue `default`).

**Plan.** `Publisher` inserts each delivery with `InsertOpts.Queue = "events."+consumerModule` (the prefix
of the consumer name); `AEDST_JOBS_QUEUES` accepts them; API replicas default to all event queues. The
subscription catalog (event type -> consumer names) is separated from the handler map, so a process
that does not host a consumer still knows to insert its delivery (remote entries from
`AEDST_EVENTS_REMOTE_CONSUMERS` or a generated `events/catalog`). Add the River job kind
`platform.event_forward` as the extension point for a future broker bridge (River stays the outbox).

**Diff outline.** `platform/events` (queue per consumer, catalog type), `platform/jobs` (queue validation
and `KnownQueues`), `modulekit` (catalog from `Subscribe`), `config` (queue names), Helm values schema,
`runbook-extract-service.md` step 1, ADR-0014 addendum.
**Why you decide.** Without it a consumer-only worker is structurally impossible (all deliveries share
`default`), but it adds a queue per consumer module and a concept (the catalog) for a split nobody has
asked for yet. **Risk.** Medium (job routing); the topology test pins the behaviour.
**Effort.** 2 days. **Recommendation.** Defer until the first extraction is scheduled.

## 4. `AEDST_MODULES` and `AEDST_SERVE_HTTP`

**Touches:** ADR-0001 ("one deployable"), the module registry decision (`cmd/server` names no module).

**Plan.** `AEDST_MODULES` (comma list, default all) selects registered modules in `modulekit.Ordered`
and fails startup when a `Requires` target is not enabled; per-module config validation (storage,
push, integrity) and the push/storage clients run only for enabled modules; `AEDST_SERVE_HTTP=false`
makes a worker mount only `/livez`, `/readyz`, metrics; `registry_test` accepts a subset registry in
`cmd/<service>/modules.go` as long as `cmd/server` imports every module. Helm: `workers[].modules`.
**Risk.** Medium-high (config validation currently assumes all modules). **Effort.** 2-3 days.
**Recommendation.** Approve together with item 3, when the first service is cut; useful earlier only to
shrink a media worker's config surface.

## 5. Admin audit-first instead of cross-module transactions

**Touches:** `decisions/server.md` "AdminService audit entries are written in the target module's
transaction through `*Tx` api methods ... revisit when admin is extracted".

**Plan.** Move the operator RPCs to their owners (`tasks.v1.AdminService`-style RPCs: DeleteTask,
ListAllTasks, Stats, CountByOwners; `notifications.v1`: Broadcast, CountActiveDevices) behind the admin
role. Admin writes an `admin.audit_log` row in state `pending` and a River job `admin.apply` in its own
transaction; the job calls the owning module's API with the audit id as the idempotency key and marks
the row `applied`/`failed`. The in-process `*Tx` path stays the default until a module is extracted.
**Trade-off.** The audit row appears before the action (a crash leaves `pending` rows: reconciled by
the job); the single-transaction guarantee is traded for the ability to extract. The append-only trigger
(shipped) must allow the one `pending -> applied` transition, so it needs an explicit state column and a
narrower guard. **Effort.** 3-4 days. **Recommendation.** Only when admin or a target module is
extracted; keep the current design until then.

## 6. buf workspace, one module per bounded context

Does not contradict a decision. Today one `buf.yaml` covers `api/proto`; a workspace with a module per
bounded context (and optionally BSR) would let each service publish its contract on its own and lets
`buf breaking` run per module. **Effort.** half a day without BSR. **Recommendation.** Do it with the first
extraction (item 3/4), not before.

## 7. `AdminTask.status` as `aedst.tasks.v1.TaskStatus`

`admin.proto` carries the status as an `int32` "to avoid a cross-package import". Importing the tasks
enum is cleaner, but it is a **breaking contract change** (JSON clients see the enum name instead of a
number; `buf breaking` flags `int32 -> enum`) and the Android admin feature
(`apps/android/feature/admin`, generated from `admin.proto`) must change in the same release.
**Recommendation.** Do it only with an Android release that handles both; until then keep the int and
the comment. **Effort.** 2 hours server + the Android change.

## 8. Enum vs `TEXT + CHECK` for the template

`tasks.status` and `tasks.priority` are PostgreSQL `ENUM`s; most other modules use `TEXT` with a
`CHECK`. ENUMs cannot drop values, `ALTER TYPE ... ADD VALUE` has transaction caveats, and pgx cannot
bind enum arrays (the code already casts through `text[]`). **Recommendation:** `TEXT + CHECK` for
new tables (record it in `AGENTS.md` "Migrations"), and migrate `tasks` only if a status is ever
added or removed. This is a convention for every future clone, hence the owner's call.

## 9. Migration squash before the first clone

Folding the create-then-drop history into one `00001` per module (tasks 00002-00010, notifications
00001-00004, platform 00001-00002) removes the relay upgrade tests and the dead outbox/inbox DDL, but it
rewrites migration history: it is safe only while **no database has ever applied the old files**. The
files shipped here are not squashed. **Recommendation.** Squash right before the template is first
cloned or deployed; verify by diffing `pg_dump --schema-only` of both histories. Say when.
