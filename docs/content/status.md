---
title: "Platform status and profiles"
description: "What has actually been run, which platforms are Core and which are frozen, and which parts of the template a project needs."
---

# Platform status and profiles

What has actually been run, and which parts of the template a project needs. Read this before building on a platform: "Accepted" in [decisions.md](/decisions) records a *decision*, not that the code builds.

## Working mode: Core first

**Core = Server + Web** is the default. `task generate|lint|test|build|check` run Core only; `PROFILE=full` adds the frozen platforms. Android, Apple and Desktop are **frozen**: bug fixes and the work already scoped in their own tasks only, no new features, until each has had one green CI run on a clean GitHub runner. The rule exists because a feature costs about five times more when it must land on five clients and only two clients are verified.

A frozen platform is unfrozen by recording its first green run in "CI evidence" below. Nothing else unfreezes it.

**Owner exception, 2026-11-21.** The owner explicitly ordered three pieces of work on the frozen platforms
before their first green run: UI kit parity with `ui-kit.yaml` (61 components on Android, Apple and
Desktop), the Kotlin Multiplatform structure on Android (steps 2 to 4 of 7 done, see [KMP structure](/android/kmp)), and "one business logic, two UI builds" on Apple.
The exception covers only these; the platforms stay frozen for product features, their status stays
"not verified", and everything written under the exception is reported as "written, not compiled" until
a compiler has seen it (Apple, Desktop and the Gateway have no toolchain on the authoring machine).

## Verification status

Dates are 2026-11-04 unless stated. "Verified" means run on the authoring machine; GitHub runs are recorded separately under "CI evidence".

| Platform | Status | Evidence |
|---|---|---|
| Server | **Verified** (build, vet, unit tests, architecture test, golangci-lint) / **UNVERIFIED** (integration tests since the auth removal, migration `00004`, image CI job, cluster, `buf breaking`, govulncheck) | `CGO_ENABLED=0 go build ./... && go vet ./... && go test -short ./...` pass; `golangci-lint run ./...` reports 0 issues. First-party auth was removed (ADR-0019): the server is a pure OIDC resource server and requires `AEDST_OIDC_ISSUER` and `AEDST_OIDC_AUDIENCE`. Docker is not available on the authoring machine, so integration tests compile (`go vet -tags integration`) but did not run; they now sign in through an in-process OIDC provider (`internal/platform/auth/authtest`). River was bumped to 0.51.0 (whether it needs a new River schema migration is **UNVERIFIED**). Helm, CloudNativePG and Argo CD manifests are not verified against a cluster |
| Web | **Verified** (typecheck, Biome, knip, unit and browser tests, `next build`, bundle budget) / **UNVERIFIED** (real IdP, Playwright e2e and Storybook after the 2026-11-04 bumps, visual baselines) | app: 481 unit and 216 browser tests; admin (Vite SPA): 39 unit/browser tests, BFF: 96 server tests, 11 Playwright e2e against the built BFF with the mock IdP; landing: 38. Browser tests were flaky under load and passed on rerun. Bundle (2026-11-05, after tasks `entries/*`, a lazy Sentry browser SDK and on-demand date-fns locales): `/tasks/[id]` first load **352.5 KB** (was 479.0), heaviest tasks route `/tasks/new` 399.6 of 412 KB, largest chunk 101.8 of 110 KB, total JS 876.3 of 905 KB; per-route budgets were lowered to measured + ~3%. Sentry's late init, delivery through `/monitoring` and Replay after consent were not checked in a browser; a `reportError` call made before the SDK chunk loads is dropped (uncaught errors in that window are buffered). The web sign-in is Authorization Code + PKCE (`oauth4webapi`) and has **never been run against a real ZITADEL** |
| Android | **Frozen.** Partly compiled 2026-11-21 (Windows, JDK 21, Gradle 9.9.2, AGP 9.5.2, Kotlin 2.5.0-RC): every `core/*` module except `capabilities` and `media`, plus the five `feature/<name>/domain` Kotlin Multiplatform modules (android and jvm targets) / **UNVERIFIED** (`feature/*` Android modules, `core/capabilities`, `core/media`, `app`, `app-tv`, `assembleDebug`, device) | Kotlin Multiplatform structure, steps 2 to 4 ([KMP structure](/android/kmp)): `core/common`, `core/database` (Room 3.0.3, schema identity hash unchanged) and the feature domains compile for both targets and their tests pass; `core/outbox` unit tests pass. `assembleDebug` is blocked by two things outside the code: the generated ConnectRPC client is absent (`make generate` not run) and Compose BOM 2026.11.01 needs compileSdk 37.1 (37.0 installed). Feature modules were edited statically. Default locale is now English (`values/`), Russian is `values-ru/`. Policy scripts pass. Never run on a device |
| Apple | **Frozen. Not built** (UNVERIFIED) | Nothing compiled. Sign-in is browser-only (`ASWebAuthenticationSession`); password mode and the admin user list were removed without a compiler. The feature packages and the app shell were restructured into shared logic plus one UI layer per platform ("one business logic, two UI builds", 2026-11-21): written, not compiled. Static scripts pass (`check-feature-boundaries`, `check-feature-layers`, `check-apple-swift-policy`). Snapshot reference images are not recorded. Never run on a device |
| Gateway (`apps/gateway`, Rust) | **Written, NOT compiled or tested** (UNVERIFIED) | Authored 2026-11-18 on a machine without cargo. `cargo fmt`, `clippy`, `test`, `deny`, the crate feature names marked UNVERIFIED in `Cargo.toml`, `Cargo.lock` and the Go to NATS to Rust to WebSocket test (`natsbridge/gateway_e2e_integration_test.go`) have never run. Static pass of 2026-11-21 (still no compiler): every version and feature name in `Cargo.toml` exists on crates.io (the `rust_crypto` and `opentelemetry-*` names are no longer UNVERIFIED; that they are sufficient is), fixes from reading the code against the sources of the pinned crates on docs.rs (test key encoding needs `ed25519-dalek` `alloc`, a socket write timeout, an explicit type in `ws::close`), and a no-cargo dependency gate (`apps/desktop/scripts/check-approved-crates.sh`). Second pass the same day, also not compiled: the bearer token is no longer echoed in the handshake (the gateway answers `aedst.v1` only), browser origins fail closed, header-read timeout and connection caps through a `hyper-util` accept loop, the consumer reconnects with capped backoff and reports its state in `/readyz` and two metrics, `base64` replaces a hand-written encoder in a test, unused `tokio-tungstenite` removed. The source was reformatted by hand towards rustfmt defaults; **rustfmt was not run**, so `cargo fmt --check` may still report differences. The Go side (`internal/platform/natsbridge`) is verified: unit tests against an in-process JetStream server, `architecturetest`, config and cmd tests pass |
| Desktop (`apps/desktop`) | **Frozen. Windows only** | Last verified on Rust 1.99.1, Slint 1.18.1 (pins are now Rust 1.100.0, Slint 1.19.0, UNVERIFIED: no cargo here, `Cargo.lock` not regenerated): `cargo fmt --check`, `cargo clippy --workspace --all-targets -- -D warnings`, `cargo test --workspace` (377 passed) and `cargo deny check` pass on Windows. UI tests use `i-slint-backend-testing`. Added 2026-11-21 without cargo (scripts pass, **nothing compiled**): crate-boundary and feature-layout gate `scripts/check-feature-boundaries.sh`, approved-crate and shared-version gate `scripts/check-approved-crates.sh` ([desktop/boundaries](/desktop/boundaries)); `clippy::expect_used` raised from warn to deny and `[bans.workspace-dependencies]` added to `deny.toml`, both never evaluated by a toolchain; all 48 `[workspace.dependencies]` versions and feature names exist on crates.io. **Never built on Linux**, never run against a real server or IdP, Velopack update path and packaging unverified, no screen-reader pass, no Linux accessibility check. The Qt 6 / C++ app was deleted on 2026-11-04 (it had never been compiled) |

Expect the first real build of Android, Apple and Desktop-on-Linux to surface compile errors, version mismatches and CI gates that need tuning. Record each finding (and the fix) in [decisions.md](/decisions) instead of silently patching, and update this table when a platform passes its first build.

**Server performance gates, 2026-11-21.** Written and run on the authoring machine: the cache-aside helper
(`cache.Aside`, unit tests on miniredis, one use in `GetTaskStats`), the slow-query tracer, the N+1
architecture test and the benchmark regression gate (`task bench:check`, self-test included). Written but
**UNVERIFIED**: the `bench` and `load` jobs of `server-ci.yml` (never run on GitHub; `load` also needs the
`LOAD_OIDC_*` variables), `auto_explain` in the CloudNativePG base and the slow-query flags of the Compose
Postgres (no Docker or cluster here), and the cache against a real DragonflyDB. No `default.pgo` is committed.

**Web performance, SEO and accessibility gates, 2026-11-21.** Ran on the authoring machine (Windows), all
green: typecheck of the three projects, Biome, knip x3, unit tests (app 506 passed and 30 skipped, admin
8, admin BFF 97, landing 39), browser tests with one worker (app 222, admin 31), builds of app, landing
and admin, `pnpm check:bundle` x3, `pnpm check:selftest` (56 fixtures), `pnpm check:source` x3,
Playwright on the builds with Chromium (app 97 tests, landing 25, admin 21) and the root naming,
file-size, boundaries, docs and i18n checks.

The bundle regression was two SDK bumps of the 2026-11-18 catalog change, not the bumps of 2026-11-21.
Both are held again as exact pins ([decisions/web](/decisions/web)): `@sentry/*` at 11.12.0 (from 11.13.0
the lazy Sentry chunks grow by 51 KB: total JS 928.6 KB of 905) and `posthog-js` at 1.440.0 (1.450.1
makes the largest chunk 117.3 KB of 110). With the pins the largest chunk is 101.8 KB.

Lighthouse CI (`lhci autorun`, Chrome found, 3 runs per URL) passes for both projects after the client
bundles were cut; no assertion was weakened and the script and page-weight limits were lowered to the new
measurements.

- `landing`, 12 runs (`/en`, `/ru`, `/ar`, `/en/privacy`): performance 0.94 to 0.98, LCP 1.72 to 2.05 s,
  CLS at most 0.010, TBT 93 to 246 ms (medians 113 to 146 against 150), script 147.8 kB, page weight
  271 kB in 13 requests. Before the cut: script 241.8 kB, performance 0.77 to 0.94, LCP 2.3 to 2.8 s.
  Removed from the client: the base-ui select and accordion, the next-intl client runtime, next-themes,
  `next/link` and the kit button of the error page; fonts preload the Latin subset only; Tailwind scans
  only the kit files the landing renders (CSS 32.2 to 10.0 KB). First load 223.5 to 136.7 KB.
- `app`, 9 runs (`/en`, `/ru`, `/ar`): performance 0.93 to 0.96, LCP 2.18 to 2.31 s, CLS 0, TBT 67 to
  204 ms, script 373.2 kB against 400 kB before (432.5), page weight 602.7 kB in 36 requests. The query,
  URL-state and outbox providers moved from the root layout to the signed-in layout: sign-in first load
  301.5 to 246.1 KB. Side effect: the signed-in routes grew about 7 KB each (total JS 893.7 of 905 KB).

The timing numbers come from a machine with little free memory: single runs still scatter (one `landing`
run of 12 had TBT 246 ms; `lhci` asserts on the best of the three runs per URL, and the medians pass too). An earlier `landing` attempt stopped twice when
Chrome failed to launch. Session cookies: an oversized value is now split across numbered cookies and a
session over the cap is refused ([decisions/web](/decisions/web)); not run against a real ZITADEL.

**UNVERIFIED:** `web-ci.yml`, `landing-ci.yml` and `admin-ci.yml` have never run on GitHub; the
signed-in Lighthouse run, the Firefox, WebKit and phone projects of the e2e suites, and Storybook
(including the `ModeToggle` stories, whose a11y check is on again) were not run in this change.

### What can be verified where (the authoring machine: Windows, Go, Node, pnpm, JDK, Rust)

`task doctor` prints this for the machine you are on; `task verify:<platform>` prints the exact commands.

| Platform | Level reached here | What cannot run here |
|---|---|---|
| Server | build, vet, unit tests, lint | Docker-based integration tests, libvips tests, image job, cluster manifests |
| Web | typecheck, lint, unit and browser tests, build | Real IdP, Playwright e2e and Storybook (not re-run), visual baselines |
| Android | policy scripts only (Gradle blocked by a lock this round) | Compile of the Room 3 migration, device runs |
| Apple | static scripts only | Everything Xcode-based |
| Desktop | fmt, clippy, tests, deny on Windows | Linux build, packaging, real server |

"Static only" means no compiler has seen the code. Passing a repo-wide policy script says nothing about whether a platform builds.

### Exit criteria for "Verified" (unfreezing)

A frozen platform moves to **Verified** only when all of these have run on a clean runner and passed:

- **Android**: `task android:generate android:lint android:test android:build` (JDK 21), then an emulator smoke run.
- **Apple**: `task apple:generate apple:lint apple:test` on macOS with Xcode, plus a simulator launch.
- **Desktop**: `cargo fmt --check`, `cargo clippy --workspace --all-targets -- -D warnings`, `cargo test --workspace` and `cargo deny check` on Ubuntu and Windows, plus one sign-in against a real IdP.

## Profiles

The template is deliberately complete; most products need less. Pick a profile and delete or ignore the rest. The server contract and the shared design tokens do not depend on which clients you keep.

| Profile | Keep | Drop |
|---|---|---|
| **Core** (default, and the working mode of this repo) | `apps/server`, `apps/web`, `docs`, `packages/design-tokens` | `apps/android`, `apps/apple`, `apps/desktop` |
| **Core + mobile** | Core + `apps/android` and/or `apps/apple` | `apps/desktop` |
| **Full** | everything | none |

Infrastructure scales the same way. Start with Docker Compose (`task dev`) and one Postgres. Move to the HA Postgres / Helm / GitOps setup in [deployment](/server/deployment) when you have a production target; none of it is needed to develop.

### Removing a platform

1. Delete `apps/<platform>` and its workflows in `.github/workflows` (`<platform>-*.yml`).
2. Remove its includes and `<platform>:*` tasks from `Taskfile.yml` and from the aggregate tasks.
3. Remove its path from `check:boundaries`, `renovate.json`, `mise.toml` tools that only it needs (for example `java` for Android) and `scripts/update-deps.sh`.
4. Remove its rows from the "Approved stack" tables in [library-first](/library-first) and its section in [decisions.md](/decisions).
5. Keep the server `.proto` contract unchanged; it is shared by every client.

Or run `task template:new -- --profile core` (see the README), which does all of this from `scripts/template-profiles.json`. Run `task check` afterwards.

## Repo-wide policy checks

Cheap checks that span all apps; run them with `task check` (individually: `task check:naming|file-size|colors|i18n|boundaries`) and in CI via `policies-ci.yml`. Apps add their own, stricter checks.

| Check | Command | Rule | Configuration |
|---|---|---|---|
| File size | `task check:file-size` | Hand-written source: up to 300 lines green, 301-400 yellow, 401-500 orange (high warning), over 500 red and fails | `scripts/file-size.config`; policy in `CONVENTIONS.md` |
| Color literals | `task check:colors` | No hex/rgb/hsl/oklch/`Color(0x...)` colour literals in hand-written UI code (`.slint` and `.rs` included); use design tokens | `scripts/color-literals.allowlist` |
| i18n parity | `task check:i18n` | Same keys and placeholders in en, ru, tg, uz, ar within each platform (Desktop reads gettext `.po` catalogs; `--cross` for the cross-platform report) | `scripts/i18n-parity.allowlist`; [i18n](/i18n) |
| Boundaries | `task check:boundaries` | No feature-to-feature dependency on web, android, apple, desktop; server `architecturetest`. The desktop script (bash + node, no cargo) also checks the feature layout and the approved direct Rust dependencies of `apps/desktop` and `apps/gateway` | per-app scripts |
| Naming | `task check:naming` | File and directory naming | `CONVENTIONS.md` |

<!-- metrics:start (generated by scripts/status-metrics.mjs; do not edit) -->

File-size policy counts (`task check:file-size`, hand-written source only):

| Platform | Files | Yellow (301-400) | Orange (401-500) | Red (over 500) |
|---|---|---|---|---|
| server | 443 | 9 | 7 | 0 |
| web | 751 | 5 | 0 | 0 |
| android | 451 | 1 | 0 | 0 |
| apple | 397 | 3 | 0 | 0 |
| desktop | 314 | 15 | 4 | 0 |
| root | 88 | 5 | 0 | 0 |

<!-- metrics:end -->

A pass of these scripts says nothing about whether Apple, Android or Desktop compile.

## Changes on 2026-11-04 (owner decisions)

- **Qt 6 / C++ Desktop deleted.** The Rust + Slint app (then `apps/desktop-rs`) is the only Desktop; on 2026-11-05 it was renamed to `apps/desktop` and the last untracked Qt leftovers were removed (ADR-0001 in `apps/desktop/docs/adr/`).
- **First-party auth removed** from the server and from every client (ADR-0019). Clients sign in through the IdP only. `AdminService.ListUsers` and `users_total` were removed with it because they read the deleted table; the admin clients dropped the user list.
- **Core-first profile** is the working mode (above).
- **Dependencies** brought to the latest stable verified on each registry; exceptions are recorded in each platform's decisions page (detekt 2.0.0-alpha.6 has no stable release, `posthog-js` held at 1.440.0 for bundle size, `connectrpc` pinned exactly, `rand_core` 0.6 for `rsa` 0.9).
- **Kept after review**: go-redis (with miniredis for tests), `sideshow/apns2` (FCM for iOS would need the Firebase iOS SDK; revisit conditions are in the server decisions), the `sharedtime.Clock` abstraction beside `testing/synctest`, and the hand-written SQLite migrator on Desktop (`rusqlite_migration` needs rusqlite 0.40 while the workspace is on 0.41 and it has no hash freeze).
- **Desktop telemetry**: `posthog-rs` removed. Product analytics will go through the Go server; the server has no ingest RPC yet, so the Privacy switch is disabled and the RPC is a recorded follow-up.

## Changes on 2026-11-18 (location-transparent units, completed)

- **ADR-0022** closes the gaps ADR-0020 left: service identity (`serviceauth`, `AEDST_SERVICE_IDENTITY_*`), event forwarding across databases (`events.proto`, `platform.event_forward`, `AEDST_EVENTS_FORWARD`, `AEDST_EVENTS_INGEST_ENABLED`), one River client per module database (`Env.JobsFor`/`PublisherFor`; `tasks`, `notifications`, `media`, `admin` use `PoolFor`), admin's audit-first path for a unit on another database, and `MediaOperatorService` with a `media` Remote hook.
- Verified on the authoring machine: `go build`, `go vet` (also `-tags integration`), `go test -short ./...` including `architecturetest`, `golangci-lint` (0 issues), `buf lint`. **UNVERIFIED:** none of it ran against Postgres, River's tables or a real IdP (no Docker): per-database River clients, `Deliver` into a real `river_job`, the audit-first path across databases and a ZITADEL machine user with the `internal` role need `task check:full` and one real client-credentials call. `helm lint` was not run (no helm here); `values.schema.json` gained `serviceIdentity` and `events`; its `config` object has `additionalProperties: false` and I found no `nats` entry in it, so `helm lint` may reject the existing `config.nats` values (UNVERIFIED, not caused by this change).

## Core re-run on 2026-11-18 (Windows, no Docker, no `task`)

- **Server, passed:** `go build`, `go vet` (also `-tags integration`), `go test -short ./...`, `golangci-lint` (0 issues), `buf lint`, `govulncheck` (no vulnerabilities). golangci-lint warns that `exhaustive.ignore-enum-types` was replaced by `ignore-types` in `.golangci.yml` (not changed: the file has uncommitted edits from another session).
- **Web, found and fixed:** `pnpm typecheck` and `pnpm lint` were failing in admin (`server/security/route-guard.test.ts` passed a `fallbackLocale` that `decideRoute` does not accept and expected `/ru/forbidden`; the documented behaviour is the locale-less `/forbidden`). The test was corrected; lint, typecheck and the test now pass. The "Verified" claim above was therefore not true for admin until this fix.
- **Web, passed:** app unit 499 passed (30 skipped), admin unit 8, admin BFF 91 (earlier text said 96), landing 38, `pnpm build` for app, admin and landing.
- **Browser tests (Chromium installed afterwards):** admin 31 passed; app 216 passed on the second run. The first app run on a cold Vite cache failed 4 suites ("Vite unexpectedly reloaded a test", `use-intl` re-optimized); the rerun was green. Cause found: `apps/web/app/vitest.config.mts` listed a bare `use-intl` in `optimizeDeps.include`, which does not resolve from `app` (pnpm hides it behind `next-intl`), so Vite skipped it and found it mid-run; `next/navigation` was also discovered late. Fixed with `next-intl > use-intl` and `next/navigation`. After the config change (which invalidates Vite's dependency cache) two runs gave 216 passed with no reload. A true cold run on a fresh clone or CI runner was NOT reproduced: deleting `node_modules/.vite` was blocked in this session, so it is UNVERIFIED.
- **Not run:** Playwright e2e, Storybook, the bundle budget check, Docker integration tests, `task` aggregates (`task` is not installed), and everything on a clean GitHub runner.

## Changes on 2026-11-21 (owner decisions after a full audit)

Decisions recorded in [decisions](/decisions): one structure on every platform (module, then feature), the
UI kit manifest, kebab-case web file names, Kotlin 2.5.0-RC, PostgreSQL 19, KMP without an iOS target as
the Android target structure, and one business logic with two UI builds on Apple. Frozen platforms stay
frozen: for them only version pins and decision rows changed.

- **Versions.** PostgreSQL 18 to 19 (Compose, `postgrestest`, CloudNativePG `19-standard-trixie`). Kotlin
  2.4.21 to 2.5.0-RC (owner exception to the stable-only policy; final 2.5.0 is not published). AGP 9.5.2,
  Gradle wrapper 9.9.2 (checksum from services.gradle.org), Compose BOM 2026.11.01, lifecycle 2.11.1,
  navigation3 1.2.2, Tuist 4.218.2, Ruby 3.4.13, AWS SDK patches, web catalog minors and patches, docs and
  design-token dependencies, Compose images (ZITADEL 4.20.5, Traefik 3.7.19, imgproxy 4.0.24, otel-lgtm
  0.41.1). **UNVERIFIED:** nothing ran against PostgreSQL 19 (no Docker); Android was not compiled with
  Kotlin 2.5.0-RC or any of the new pins; the images were not started. Not bumped: `posthog-js` (held for
  the chunk budget), `@testing-library/jest-dom` 8, PostHog 4 on Android and Apple (majors on frozen
  platforms), and the Rust crates (`Cargo.lock` cannot be regenerated here: no cargo).
- **Web.** 140 files renamed to kebab-case, rule inverted in the conventions, `check-naming.sh` and Biome.
  `shared/ui` gained `data-table`, `date-picker`, `sonner`, `typography`, `trace` and `code-block` (61 of
  61 in `ui-kit.yaml`; `toast` is an alias of `sonner`; `code-block` has no highlighter yet, open
  decision). `admin` serves `robots.txt` (`Disallow: /`). `landing` pages set `og:url` to their own
  canonical. The i18n parity check now covers the `i18n/common` catalogues (11 web bundles, was 8).
- **Server.** `SELECT *` and `RETURNING *` removed from `sql/media` and gated by
  `architecturetest` (`TestQueriesNameTheirColumns`; generated code is unchanged).
- **Gates.** `task check:ui-kit` (manifest against the four kit trees; variants and sizes against the web `cva` definitions and the Kotlin, Swift and Slint enums; `missing` fails on every platform) and the API reference drift check
  now run in `policies-ci.yml`. The generated Pagefind index is excluded from the file-size check.
- **Verified on the authoring machine (Windows):** server `go build`, `go vet` (also `-tags integration`),
  `go test -short ./...`, `golangci-lint` (0 issues), `sqlc vet`; web `pnpm typecheck`, `pnpm lint`, unit
  and browser tests per project, knip; repo checks for naming, file size, colours, i18n, boundaries, docs,
  features and the UI kit. **Not run:** `next build`, Storybook's full story suite, Playwright e2e, the
  bundle budget, Docker integration tests, anything on a GitHub runner.
- **Known gaps, tracked in [roadmap coverage](/engineering/checklists):** the feature level exists on no
  platform; the UI kit files now cover 61 of 61 on every platform (Android 59 + 2 `native`; Android `core/ui` compiled and unit-tested on the authoring machine, Apple and Desktop written, not compiled); `landing`
  and `admin` have no performance gate in CI; outbound webhooks were never run against Postgres, River or a real receiver (see the server API
  entry below).

- **Server API work (2026-11-21, same day).** OpenAPI 3.1 per proto package (`docs/public/openapi`,
  drift-checked in `server-ci.yml`); docs are modular (`docs/content/modules/<module>/`, API pages from
  buf's descriptor); plain HTTP errors are RFC 9457 and Connect errors carry typed details; OAuth scopes are
  parsed and enforceable in `AEDST_ROLE_POLICY`; conditional reads (`ETag`, 304) exist for marked reads
  (`GetCapabilities`); per-procedure rate limits are configuration (`AEDST_PROCEDURE_RATE_LIMITS`); the
  `tasks` event payloads have a Protobuf contract. **Built, off by default, unit-tested only:** outbound webhooks (the `webhooks`
  module: endpoint registry with secrets encrypted at rest, fan-out of task and media events, delivery log,
  operator API; `AEDST_WEBHOOKS_ENABLED`). **Verified on the authoring machine only** (unit tests, `architecturetest`, lint,
  `buf lint`, `buf breaking` against an export of `main`): nothing ran against Postgres, River, a
  real identity provider or a GitHub runner, and no client sends a Connect GET yet. The Helm value
  `config.procedureRateLimits` was written without `helm` (UNVERIFIED). **Clients:** Android, Apple and
  Desktop must regenerate their Protobuf code for the new package `aedst.tasks.events.v1` and the
  `idempotency_level` option on `GetCapabilities` (their generated code is not committed); no client
  source refers to either by hand (checked with a repository search), and the web clients were
  regenerated and typecheck.

## Open items

Not done (recorded honestly, not hidden):

- Run the integration tests for ADR-0022 against Postgres (Docker): a producer on its own database with a consumer behind `AEDST_EVENTS_FORWARD`, the module River clients, and an admin mutation on a unit hosted on another database; create the ZITADEL machine user with the `internal` role.

- Run the integration tests against Postgres (Docker) after the auth removal; check `buf breaking` and `govulncheck`; confirm River 0.51's schema migration.
- Compile Android (Kotlin 2.5.0-RC, Room 3, AGP 9.5.2) and regenerate the Room schema if the identity hash changed.
- Apple and Desktop-on-Linux have never been compiled/built; no on-device run of Keystore/Tink/AppAuth/Play Integrity/App Attest/Keychain on any platform.
- Desktop: four `zip` advisories (RUSTSEC-2026-0367/0368/0369/0429) arrive through `velopack` and are ignored in `deny.toml` with a written reason; whether Velopack reaches the affected code is UNVERIFIED. Four transitive crates behind Slint are marked unmaintained.
- Desktop: no `aedst-feature-auth` crate (auth lives in `aedst-oidc`, declared exception; it has no views and no catalogue, the sign-in strings are in the shell catalogue `aedst-desktop.po`, see [desktop/i18n](/desktop/i18n)); `crates/aedst-spike` is still on disk, excluded from the workspace and from every gate; `client-identification` and `forced-upgrade-ux` have no replay test of `client-version-gate.json`; the Slint Royalty-free licence terms need the owner's confirmation before release.
- Admin (Vite + Hono BFF): the Docker image has not been built, a real ZITADEL sign-in has not been run, multi-replica refresh behaviour is untested, `admin-ci.yml` has not run on GitHub, Trusted Types is report-only, and `admin-ci.yml` now runs `check:feature-boundaries` and `check:deps`.
- Web import graph (all three projects): the authoritative boundary gate is `apps/web/app/scripts/check-feature-boundaries.sh`. `dependency-cruiser` is supplementary: dependency-cruiser 18.8.0 (latest) supports TypeScript `<7.0.0 || >=7.1.0`; the workspace is on TypeScript 7.0.2 and 7.1 exists only as a beta (`npm view`, 2026-11-21), so no supported stable pair exists and it prints `missing-tsc-transpiler` and parses with its fallback; its negative fixtures pass, but a green `check:deps` does not prove the graph is complete ([decisions/web](/decisions/web)).
- Web bundle: first load is now 299-400 KB per route; run the Playwright e2e and check Sentry delivery in a browser after the lazy-SDK change.
- CI workflows and the server `image` job have never executed on GitHub.
- Apple snapshot baselines and web visual-regression baselines are unrecorded.

## Parity matrix

`features.yaml` is the machine-checked source for feature x platform and behaviour x platform status ([parity](/parity)). Desktop reports two missing behaviours (client-identification, forced-upgrade-ux). Known deviations: web keeps the refresh cookie on the first `invalid_grant` (15 s multi-replica rotation window); the TV app does not filter features.

## CI evidence

Everything above that says "Verified" was run on the authoring machine. A GitHub Actions run is a different, stronger kind of evidence (clean runner, pinned toolchains), and this table records it separately so the two are never confused.

| Workflow | Observed run on GitHub | Evidence |
|---|---|---|
| `server-ci.yml` (including the `image` job: build, Trivy, Syft SBOM, ghcr push, keyless cosign) | none yet | UNVERIFIED |
| `web-ci.yml`, `admin-ci.yml`, `landing-ci.yml`, `web-mutation-nightly.yml` | none yet | UNVERIFIED |
| `android-ci.yml` | none yet | UNVERIFIED |
| `apple-ci.yml`, `desktop-ci.yml` | none yet | UNVERIFIED; the first run is expected to fail and surface the real problems |
| `policies-ci.yml`, `docs-ci.yml`, `tokens-ci.yml` | none yet | UNVERIFIED |

Produce the evidence after the first push and the GitHub settings in `docs/agent/github-setup.md`:

```bash
gh workflow run server-ci.yml
gh run list --limit 20
gh run view <run-id> --log-failed
```

Replace "none yet" with the run URL, the date and the commit SHA, one row at a time. Do not write "Verified" for a workflow until its run is green on a clean runner; a workflow that was only parsed is not evidence.

## Graduation of frozen platforms

Until a frozen platform passes its exit criteria above:

- a new product uses the **Core** profile (`task template:new -- --profile core`);
- changes to it are reviewed with the matching `*-reviewer` subagent and reported as "statically reviewed" or "verified on Windows", never "works";
- its `features.yaml` status stays `implemented`, never `verified`;
- the first real build is done on its own branch, and every finding is recorded in [decisions.md](/decisions) before the table above is changed.
