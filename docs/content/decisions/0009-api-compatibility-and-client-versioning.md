---
title: "ADR-0009: API Compatibility and Client Versioning"
description: "Accepted."
---

# ADR-0009: API Compatibility and Client Versioning

## Status
Accepted.

| Part | State |
|---|---|
| Proto contract rules, `buf breaking` gate | Implemented: `task breaking` / CI job (`buf breaking --against main`, mode `FILE`) |
| Server: `X-Aedst-Client` parsing, minimum-version gate (`AEDST_MIN_CLIENT_VERSIONS`), `CLIENT_UPGRADE_REQUIRED` error detail | Implemented and unit-tested (`internal/platform/httpserver/clientversion.go`, `clientversion_test.go`); exercised end to end by the integration test `TestServer_CapabilitiesAreNegotiatedBeforeSignIn` |
| Server: recommended versions (`AEDST_RECOMMENDED_CLIENT_VERSIONS`), request metric by client, capability negotiation (`aedst.capabilities.v1.CapabilitiesService/GetCapabilities`) | Implemented and tested, see "Capability negotiation" and "Metrics" below |
| Clients send the header and show a forced-upgrade screen | Android: implemented and JVM-tested; Apple and Desktop: implemented in source, never compiled. Web: the `/api/rpc` BFF sets the header (`apps/web/shared/api/connect/client-id.ts`; web code was not verified by the server workstream). Desktop sends `desktop/<semver>` and shows the upgrade view. All four clients call `GetCapabilities` |
| Per-app build scaling | Recommendations only, see the last section |

## Context
Four client platforms (Web, Android, Apple, Desktop) call one API
([ADR-0002](/decisions/0002-connectrpc)). Mobile and desktop binaries stay in the
wild for months after a release, so the server cannot assume all clients are
current, and cannot remove or change anything a shipped client still relies on.
We need explicit rules for evolving the contract, a way to know who is calling,
and a way to retire clients that are too old.

## Decision

### Proto contract rules
- **Additive-only within `v1`**: new fields, new RPCs and new enum values are
  allowed; removing or renaming fields, changing types or changing semantics is not.
- **Never reuse a field number.** When a field is removed, its number and name are
  marked `reserved`.
- **Deprecate before removing**: mark with `[deprecated = true]` and keep the field
  working for N releases (N = the support window below).
- Clients must ignore unknown fields and treat unknown enum values as
  `UNSPECIFIED`-like (never crash).
- **`buf breaking` with `FILE` mode is the gate**: it runs in CI against `main`
  (`task breaking`) and a failure blocks the merge. A genuine breaking change is a
  new API version (below), not an override.

### Client identification
Every first-party client sends `X-Aedst-Client: <platform>/<semver>` on every
request, where platform is one of `web | android | apple | desktop`, for example
`X-Aedst-Client: android/1.4.2`. It is used for metrics (requests by client
version), logs and the version gate; it is **not** authentication and is never
trusted for authorisation.

### Minimum supported version gate
- The server reads `AEDST_MIN_CLIENT_VERSIONS`, format
  `web=1.0.0,android=1.2.0` (empty = gate disabled).
- If the header names a platform with a configured minimum and the version is lower,
  the request is rejected with Connect code `failed_precondition` and an error
  detail with reason `CLIENT_UPGRADE_REQUIRED` (domain `aedst`), so the client can
  show a forced-upgrade screen instead of a generic error.
- A **missing or unparsable header is allowed** (curl, tests, older clients that
  predate this ADR); the gate only acts on clients that identify themselves.
- The health endpoints (`/livez`, `/readyz`) are plain HTTP outside the RPC stack and
  are never gated.
- The value is plain configuration (Helm `config.minClientVersions`), so raising the
  minimum is a config rollout, not a code release.

### Recommended version (soft)
`AEDST_RECOMMENDED_CLIENT_VERSIONS` (same format, Helm `config.recommendedClientVersions`)
names the release clients should move to. Nothing is rejected: the value is
reported by `GetCapabilities` and a client below it shows a non-blocking update
prompt. Config validation rejects a recommended version below the platform's
minimum.

### Capability negotiation
`aedst.capabilities.v1.CapabilitiesService/GetCapabilities` is a **public**,
read-only RPC (module `capabilities`, stateless) that clients call at start-up and
on resume, before sign-in. It returns:

- `server_version`: `-ldflags -X .../platform/buildinfo.Version=…` for releases,
  else the VCS revision, else `dev`;
- `clients`: per platform `minimum` and `recommended`;
- `update_status` for the caller's own `X-Aedst-Client` (`CURRENT`, `RECOMMENDED`,
  or `UNSPECIFIED` when it did not identify itself or no window exists; a release
  below the minimum never gets this far, the gate rejects it first);
- `features`: a map name -> `{enabled, params, required_client_version}`. Three
  kinds of name:
  - **Coarse module ids** without a dot: one per registered server module
    (`tasks`, `media`, `search`, `admin`, `notifications`, `auth`, ...), enabled
    unless the operator switches them off in `AEDST_FEATURES`.
  - **Dotted sub-capabilities derived from what this deployment has configured**
    (`media.uploads`, `media.image_delivery`, `push.webpush|fcm|apns`,
    `auth.oidc`, `attest.play_integrity`, `attest.app_attest`),
    so a client can hide upload UI when storage is off.
  - **Operator flags and overrides** from `AEDST_FEATURES` (Helm `config.features`),
    a JSON object such as
    `{"new_search":{"enabled":true,"required_client_version":"1.5.0","params":{"rollout_percent":"25"}}}`.
    An entry named like a module replaces that module's default entry (turn a whole
    module's UI off, or gate it by client version). Dots are forbidden in these
    names, so they cannot collide with derived ones. Read at start-up; a change is a
    config rollout.

  **Client rule.** A feature the server lists is authoritative: `enabled = false`
  always wins, even for a feature the client has built. `required_client_version`
  (semver, empty = none) hides the feature on clients older than it. A feature the
  server does not list falls back to the client's default: a built-in feature is on,
  a flagged (optional, experimental) feature is off. Clients ignore names they do not know.

The answer does not depend on the user, so clients may cache it for a few minutes.
It is rate-limited per IP like the other public RPCs.

### Metrics
`aedst_client_requests_total{platform,major,status}` counts every RPC (before
authentication). `status` is `current`, `below_recommended`, `below_minimum`
(rejected) or `unidentified`. The labels are bounded on purpose, because the header
is attacker-controlled: `platform` is one of the four or `none`, `major` is a number
below 1000 or `other`/`none`. Exact versions appear in the rejection log line, never
as a label; if finer per-version telemetry is needed, collect it from the clients
or the access logs rather than widening this label set.

### Support window
- **Mobile and desktop**: the last 2 minor releases, or 6 months, whichever is
  longer. Raise the minimum only after telemetry shows the remaining share of
  older versions is negligible, and after a deprecation notice has shipped in the
  app.
- **Web**: always latest; the bundle is served from the deployment and stale tabs
  are covered by the same forced-upgrade path (reload).

### Introducing v2
A breaking change creates a new proto package, for example `aedst.tasks.v2`, served
by the same binary **in parallel** with `v1` (separate ConnectRPC handlers, shared
domain and application layers). `v1` is deprecated, kept for the support window and
removed only when the gate/telemetry show no remaining callers. Only the transport
layer knows about the version; the domain does not.

### Per-app build scaling (recommendations, not implemented)
Current state, verified in `.github/workflows`: CI is already **path-filtered per
app** (`server-ci`, `web-ci`, `android-ci`, `apple-ci`, `desktop-ci`, `docs-ci`),
and the desktop workflow additionally triggers on `apps/server/api/proto/**`.

When the feature count approaches ~10, the following are recommended; none is
implemented today:
- **Android**: enable the Gradle build cache and configuration cache
  (`org.gradle.caching=true`, `org.gradle.configuration-cache=true`), with a remote
  cache in CI.
- **Apple**: Tuist binary cache (`tuist cache`) so unchanged feature modules are
  not recompiled.
- **Desktop**: Cargo build caching in CI (not set up yet; an action must be pinned by SHA first).
- **Web**: pnpm store caching now; Turborepo-style task caching only if web grows
  into multiple packages.
- Keep modules independent so each platform's cache hits stay high (see the
  architecture pages of each client).

## Consequences
- Old clients keep working as long as the additive-only rules hold, and `buf
  breaking` makes accidental breaks a CI failure.
- Forcing an upgrade becomes an operational lever with a clear client-side UX.
- Every client must send the header and implement the upgrade screen; until they do,
  the gate has no effect on them.
- Running `v1` and `v2` together costs extra code and tests for the duration of the
  support window.
- Support windows are a product commitment: shortening them requires an explicit
  decision.
