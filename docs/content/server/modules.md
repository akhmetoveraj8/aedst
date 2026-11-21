---
title: "Modules"
description: "AEDST is an empty product template. It ships only the global modules almost every product needs, with tasks as the worked example every other module is..."
---

# Modules

AEDST is an empty product template. It ships only the **global modules** almost
every product needs, with `tasks` as the worked example every other module is
built around. Your product adds its own domain modules next to them, following
the same shape.

| Module | Owns (schema) | Depends on (via `api/`) | Contract |
|---|---|---|---|
| `tasks` | `tasks.*` | — (scopes every RPC to the caller's `user_id` from the auth context) | `aedst.tasks.v1` |
| `notifications` | `notifications.*` (inbox, push devices, preferences) | events only: `tasks` (`TaskCompleted`, `TaskDueSoon`), `media` (`MediaReady`) | `aedst.notifications.v1` |
| `search` | `search.*` (read-only `documents` projection) | events only: `tasks` (`TaskCreated/Updated/Completed/Deleted`), `media` (`MediaReady/Deleted`) | `aedst.search.v1` |
| `media` | `media.*` (+ objects in S3 / MinIO / R2) | `tasks` (`api/`: ownership check for attachments) | `aedst.media.v1` |
| `integrity` | `integrity.*` (replay table `verified_tokens` only) | — (authenticated caller from the auth context) | `aedst.integrity.v1` |
| `appattest` | `appattest.*` (`challenges`, `keys`) | — (authenticated caller from the auth context) | `aedst.appattest.v1` |
| `admin` | `admin.*` (audit log only) | `tasks`, `media`, `notifications` (read-mostly composition) | `aedst.admin.v1` |
| `webhooks` | `webhooks.*` (`endpoints`, `deliveries`) | events only: `tasks` (`TaskCreated/Updated/Completed/Deleted/DueSoon`), `media` (`MediaReady/Deleted`) | `aedst.webhooks.v1` (operator API, role `admin`; off unless `AEDST_WEBHOOKS_ENABLED`) |
| `capabilities` | none (stateless, configuration only) | — | `aedst.capabilities.v1` (public: server version, client support windows, feature flags) |

Contracts live in `apps/server/api/proto/aedst/<module>/v1/` and are the single
source of truth for all four clients (Web, Android, Apple, Desktop).

## Dependency graph

```
              tasks ◄──────────── media (api/: "does this task belong to the caller?")
                │                    │
                │ events             │ events
                ▼                    ▼
        ┌── notifications ◄──────────┤   inbox + push (Web Push / FCM / APNs)
        └── search        ◄──────────┘   projection (Postgres FTS + pg_trgm)

admin ──→ api/ of tasks, media, notifications  (nothing depends on admin)

webhooks ◄── events of tasks and media  (consumer only; POSTs them to registered endpoints)
```

Rules this graph encodes:

- No cycles. `tasks` imports no other module.
- `notifications` and `search` are **consumers only**: they react to integration
  events delivered as River jobs (idempotent handlers in their own transaction), and never
  receive synchronous calls from the modules that feed them. That is what lets
  them become independent services, or be rebuilt from scratch by replaying
  events, without touching the producers.
- `admin` may depend on many modules' `api/` packages because it is a
  composition layer; nothing depends on `admin`. Its audit entry is written in
  the same transaction as the effect, through the target module's `…Tx` api
  method — the one documented exception to "a transaction never spans modules"
  (`apps/server/AGENTS.md`).

Every new module adds a row + graph edges here in the PR that introduces it, and
is checked by `architecturetest` before merge.

## What each global module does

### Search

- Projection `search.documents` built from events; newest `version` wins, deletes
  leave tombstones that retention purges.
- `Search`: `websearch_to_tsquery` + `ts_rank_cd`, snippets from `ts_headline`
  with U+E000 / U+E001 around matches so every client renders highlighting
  natively. `Suggest`: `pg_trgm` prefix + word similarity.
- Always scoped to the caller. Keyset pagination on `(score, id)`.
- Client UIs: Web command palette (`cmdk`) + `/search`; Android/Apple/Desktop
  search screens with a 300 ms debounce.

### Notifications

- In-app inbox (list, unread count, mark read / all read) and per-kind
  preferences.
- Push fan-out as River jobs: one `notifications.push` job per notification, one
  `notifications.push_device` job per device. Providers (maintained libraries
  behind `internal/platform/push`): **Web Push** (VAPID, `webpush-go`),
  **FCM** (generated `google.golang.org/api/fcm/v1` client), **APNs** (`apns2`, token auth). An unconfigured provider is
  disabled; an invalid token deactivates the device.
- Device registration, the payload contract and VAPID rotation are described once, in [Push notifications](/server/push).
- Desktop has no push service: it polls `GetUnreadCount` with backoff and shows
  tray notifications.

### Media

- Bytes never pass through the API: `CreateUpload` returns a presigned PUT,
  the client uploads directly to object storage, then calls `CompleteUpload`.
- Completion verifies size (`Head`) and sniffed content type, then enqueues a
  job on the River queue `media` that sanitizes the original (govips/libvips:
  pixel limit, auto-orient, EXIF/GPS strip; build tag `vips`) and, for video,
  extracts a poster frame when ffmpeg is configured, then publishes
  `MediaReady`. Generic sizes (`thumb_64`, `avatar_256`, `card_400`,
  `feed_800x600`, `story_1080x1350`) are not pre-generated: when imgproxy is
  enabled `Links` returns signed imgproxy URLs as `Media.variants`
  ([ADR-0015](/decisions/0015-govips-and-imgproxy-media-pipeline)).
- Storage is the `ObjectStorage` port with presets for AWS S3, MinIO and
  Cloudflare R2. Abandoned uploads are cleaned up by retention.
- Clients: `media/{image, video, player, uploader, thumbnail, compression}` on
  every platform; images are compressed on the device before upload.

### Integrity

- Verifies Google Play Integrity **standard** tokens: `VerifyIntegrityToken(integrity_token, action, payload, request_hash, package_name)`
  returns `verified`, a failure `reason`, and the device / app / account verdicts. A rejected token is a normal
  response, not an RPC error.
- Decoding is Google's official generated client (`google.golang.org/api/playintegrity/v1`,
  `v1/{package}:decodeIntegrityToken`); the policy (package allow-list, `request_hash` binding, freshness window,
  minimum device level, `PLAY_RECOGNIZED`, optional `LICENSED`) is pure `domain` code.
- Binding convention: `request_hash = base64url_nopad(SHA-256("aedst.integrity.v1\n" + action + "\n" + payload))`;
  the app passes it to `setRequestHash`, the server recomputes it and requires Google's signed copy to match.
- Replay: `integrity.verified_tokens` primary key on SHA-256(token); purged by retention. Authenticated callers
  only; per-user rate limit `AEDST_INTEGRITY_RATE_LIMIT_PER_MINUTE`.
- Off by default (`AEDST_INTEGRITY_ENABLED=false` answers `FAILED_PRECONDITION`). Setup and troubleshooting:
  [runbook](/server/runbook#play-integrity-verification). Decision: `apps/server/docs/adr/0018-play-integrity-verification.md`.

### AppAttest

- Verifies Apple App Attest evidence from the Apple apps: `CreateChallenge()` returns a single-use 32-byte challenge (5 minutes, bound to the caller,
  stored in Postgres); `Enroll(key_id, attestation_object, challenge, bundle_id)` validates the attestation per Apple's checklist and stores the key;
  `VerifyAssertion(key_id, assertion, action, payload)` checks the signature and advances the key's counter. A rejected attestation or assertion is a normal
  response (`verified=false` + `reason`), not an RPC error.
- The verifier is project-specific code (`infrastructure/apple`) over the standard library and `fxamacker/cbor/v2`; the Apple App Attestation Root CA is embedded
  and pinned, the root pool and the clock are injected so tests use a synthetic PKI. The App ID is `AEDST_APPATTEST_TEAM_ID` + `.` + an allowed bundle id.
- Client data convention: `clientData = "aedst.appattest.v1" LF action LF payload` (LF = 0x0A), `clientDataHash = SHA-256(clientData)`. Replay: the assertion
  counter must strictly increase, enforced by one `UPDATE ... WHERE counter < $new`; a challenge is spent by one `UPDATE ... WHERE consumed_at IS NULL`.
- Rows are purged by retention (challenges shortly after expiry, keys unused for `AEDST_APPATTEST_KEY_RETENTION_DAYS`). Authenticated callers only; per-user rate limits.
- Off by default (`AEDST_APPATTEST_ENABLED=false` answers `FAILED_PRECONDITION`). Not done: Apple receipt / fraud metric, per-RPC enforcement, key revocation tooling.
  Decision: [ADR-0016](/decisions/0016-device-attestation).

### Admin

- Overview (users, tasks, media, push devices, job lag, pending jobs),
  users, all tasks (delete with a reason), broadcast notification, audit log.
- Closed by default: `/aedst.admin.v1.AdminService/*=admin` is a built-in role
  policy enforced by `RoleInterceptor`; clients show the admin area only when
  the token carries the `admin` role, but the server is the authority.

  Operator roles (`admin/module/roles.go`, mirrored for the UI in
  `apps/web/shared/lib/auth/roles.ts`): `admin` may do everything; `support` reads
  the overview, users and tasks; `auditor` reads the overview and the audit log.
  Every RPC has an explicit entry (a test fails when one is missing), the service
  wildcard stays admin-only, and `AEDST_ROLE_POLICY` can override any entry.
  Roles are granted in the identity provider, never in this codebase.
- Two ways to reach the modules it composes, chosen at startup by topology
  ([extraction runbook](/server/runbook-extract-service#step-8-admin-without-a-shared-transaction)):
  a module hosted in this process is called in-process and its mutation runs in the
  audit entry's own transaction (`…Tx` api method); a module hosted elsewhere
  (`AEDST_MODULE_<NAME>_URL`) is called through its operator service
  (`TasksOperatorService`, `NotificationsOperatorService`), and a mutation is
  **audit-first**: the entry is written as `pending` with an `admin.apply` job, and the
  job applies it (idempotent on the entry id) and resolves it to `applied` or `failed`.
  A broadcast then returns `recipients = 0` (the count is in the entry's result once applied).

## Module internal structure

```
internal/modules/<name>/
    domain/            entities, value objects, domain errors — stdlib and
                        internal/shared only
    application/       commands, queries, ports.go (interfaces they need)
    infrastructure/     postgres/, events/ (consumers), jobs — implement ports
    transport/           ConnectRPC handlers — import only their own api/ (plus platform and shared), never application or domain
    api/                the module's public boundary: the only package other
                        modules (or admin) may import; events.go holds the
                        integration events it publishes
    module/             registration with the composition root (modulekit):
                        init() -> modulekit.Register; imported only by
                        cmd/server/modules.go, by no other layer
```

`api/` re-exports just enough of `application` for other modules to call
in-process today and over ConnectRPC tomorrow — it is the seam the
[extraction path](/server/architecture#extraction-path) cuts along.

## Features: slices inside a module

A module with more than one capability is split into **features** (owner decision of 2026-11-21,
[modules and features](/architecture/modules-and-features)). A feature is a vertical slice of its module, not a
unit: the contract (`api/`, the proto service), the schema (`migrations/<module>`, `sql/<module>`, one sqlc
package) and the registration (`module/`) stay with the module, which is also the unit of extraction.

```
internal/modules/<module>/
    api/  domain/  module/                     shared by the features (module/ composes them)
    infrastructure/<pkg>/  transport/<pkg>/    shared helpers, when two features need the same code
    features/<feature>/
        application/ domain/ infrastructure/ transport/    only these four, any subset
```

- A feature imports the module's shared packages under the usual layer rules and never another feature. Code
  two features need moves to a shared package; behaviour one feature needs from another becomes a port that
  `module/` wires.
- Shared packages import no feature; only `<module>/module` does; other modules still use `<module>/api` only.
- A module with one capability stays flat (the layout above without `features/`).

Reference: `internal/modules/tasks`.

| Feature | Contains |
|---|---|
| `core` | create, read, list, edit, delete, owner counts: `application`, `infrastructure/postgres`, `transport` |
| `completion` | complete and reopen, the `TaskCompleted` event: `application`, `infrastructure/postgres`, `transport` |
| `reminders` | the due-soon River job, its scheduler, the guarded `TaskDueSoon` write: `application` (port), `infrastructure/{jobs,postgres}` |
| `operator` | cross-owner list, counts and delete (`TasksOperatorService`): `application`, `infrastructure/postgres`, `transport` |

Module-level: `api/`, `domain/` (entity, listing vocabulary), `infrastructure/store` (row mapping, event writer),
`transport/taskproto` (proto mapping), `module/` (registration, `compose.go`, the `Remote` hook, the Postgres
integration tests that span features).

Adding a feature:

1. Write the spec (`apps/server/specs/<module>/<feature>.md`); change the module's proto first when the feature
   adds RPCs (the `api-design` skill).
2. `task new:feature -- MODULE=<module> NAME=<feature>` stamps `features/<feature>/application` with a sample use
   case and its test. Add `domain/`, `infrastructure/` and `transport/` as the feature needs them; queries go in
   `sql/<module>/queries.sql`.
3. Wire it in `<module>/module` (build the service in `Setup`, embed its handler in the module's service
   handler). `architecturetest` fails until that package imports the feature.
4. If the module was flat, move its existing capability into a feature in the same change.
5. `go test ./architecturetest/...` checks the imports, the directory shape and the composition.

The earlier model, where a feature was a deployable unit with its own `api/`, `module/` and schema
([ADR-0020](../../../apps/server/docs/adr/0020-location-transparent-units.md), section 1), is superseded for
features; it still describes modules.

## Reference implementations

- **`tasks`** — request/response module: keyset pagination, idempotent
  commands, optimistic concurrency, integration events published in the command's transaction (`events.Publisher`).
- **`notifications`** — event consumer: subscribes through the producer's
  `api/` only, applies the effect in an idempotent River-delivered handler (a
  unique source event id), stores its own projection, delivers side effects (push) from River.
- **`media`** — external resource behind a platform port (`ObjectStorage`) with
  asynchronous processing on its own job queue.
- **`admin`** — composition over other modules' `api/` with an audit trail.

## Adding your own module

1. Write the spec (`apps/server/specs/<module>/`), then the proto in
   `api/proto/aedst/<module>/v1/`.
2. Scaffold `internal/modules/<module>/` with the layout above, a goose
   migration directory and an own schema; add the module to `MODULES` in
   `apps/server/Taskfile.yml` (and `scripts/lint-migrations.sh`). A module with no
   tables skips this and is listed in `statelessModules` in
   `architecturetest/registry_test.go` (today only `capabilities`).
3. Add `internal/modules/<module>/module/module.go`: an `init()` calling
   `modulekit.Register` (see [Module registry](/server/architecture#module-registry)),
   mounting the service with `modulekit.Mount` (protovalidate, body limits and the
   Connect header check come with it) and listing its proto file in `Files`.
4. Add **one line** to `cmd/server/modules.go`: `_ ".../modules/<module>/module"`.
   Nothing else in `cmd/server` changes; `architecturetest` fails if step 3 or 4 is
   missing.
5. Publish events with `events.Publisher` in the same transaction; let `search`/`notifications` consume them
   if your entities should be searchable or notify users.
6. Add a row and edges to this page.
