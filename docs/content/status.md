---
title: "Platform status and profiles"
description: "What has actually been run, and which parts of the template a project needs. Read this before building on a platform: \"Accepted\" in decisions.md records a..."
---

# Platform status and profiles

What has actually been run, and which parts of the template a project needs. Read this before building on a platform: "Accepted" in [decisions.md](/decisions) records a *decision*, not that the code builds.

## Verification status

| Platform | Status | Evidence |
|---|---|---|
| Server | **Verified** (build, vet, unit tests, integration tests by the work agent) / **UNVERIFIED** (image CI job, cluster) | `CGO_ENABLED=0 go build ./... && go vet ./... && go test ./...` pass (run by the maintainer). The work agent also ran the integration tests against embedded Postgres 18.6 (pass after reruns; the media postgres test now skips without libvips). Not run: `test:vips:integration` (no libvips here); the CI `image` job (build, Trivy, Syft SBOM, ghcr push, keyless cosign) was parsed but **never executed on GitHub**; Helm/CloudNativePG/Argo CD manifests are **not verified against a cluster** ([deployment](/server/deployment#verification-status-read-this-before-trusting-the-manifests)). Two pre-existing lint findings remain in `internal/platform/push/fcm.go` (bodyclose, deprecated `Message.Token`) |
| Web | **Verified** (build, tests, Storybook, e2e in CI mode) / **UNVERIFIED** (real IdP) | `pnpm typecheck`, Biome and knip clean; unit 34 files / 278 tests; browser project 40 files / 184 tests; Storybook tests 62 files / 177 tests green (twice) and `build-storybook` succeeds; `next build` ok; bundle budget 787.8/840 KB total, 99.5/110 KB largest chunk, 33.7/36 KB CSS (budget **not** raised); Playwright chromium 101/101 passed in CI mode (`CI=1`, `next start`; dev mode under 8 workers times out on sign-in, so CI mode is the reference). The web sign-in is OpenID Connect Authorization Code + PKCE (`oauth4webapi`); it has **never been run against a real ZITADEL**: `prompt=create`, JWT access tokens with the project audience, role assertion and `end_session` are written from ZITADEL documentation, and the signed-in email needs "User Info inside ID Token" on the app (`bootstrap.sh` does not set it). Other Playwright projects were not run. Visual-regression baselines are **not recorded** |
| Android | **Verified on JVM** (unit tests, debug and release assemble, lint, ktlint, detekt) / **UNVERIFIED** (device) | `./gradlew --continue --no-build-cache ktlintCheck detekt lintDebug testDebugUnitTest assembleDebug` ended BUILD SUCCESSFUL on the authoring machine (2026-10-09, JDK 21 via Gradle toolchain, SDK from `local.properties`): 503 JVM test cases, 0 failures, 2 skipped on Windows by design (`MigrationTestHelper` and the DataStore rename-over-existing test; both run on Linux CI). `:app:assembleRelease` and `:app-tv:assembleRelease -Paedst.allowUnpinnedRelease=true` build (R8, the protobuf-lite keep rule is in both `configuration.txt`), and `:app-tv:preReleaseBuild` is refused without pins. Shell gates (`check-policies`, `check-feature-boundaries`, `check-room-schemas`) pass. New since the last row: the offline write path is real (`task.create`/`task.complete` outbox handlers, idempotency keys, sign-out wipes the queue and caches, a failed-writes alert), Room schemas are committed and checked, DataStore recovers from a corrupt file, the Tink store fails closed, uploads clean up their staged files, every ViewModel follows one contract, every `*Screen.kt` has a `*ScreenTest` with an accessibility check, App Links, and LeakCanary/locale config/pin gate for `app-tv` too. Dependencies are fetched online (`--offline` lacks the JUnit 6 vintage engine); on Windows run `./gradlew --stop` before a build that rewrites module jars (the Kotlin daemon keeps them open). **Not run**: any device or emulator (Keystore/Tink and the new fail-closed check, AppAuth, Play Integrity, FCM, androidTest, benchmarks, App Link verification, the Hilt + Navigation 3 `SavedStateHandle` path). **No baseline profile has been recorded** (needs a device). The TV app has the device sign-in, the account screen and the forced-upgrade screen; it has no capability filtering |
| Apple | **Not built** (UNVERIFIED) | Nothing compiled (this round adds the GRDB outbox, `ClientUpgradeInterceptor`, the forced-upgrade screen, capability negotiation and the fixture replay tests, all uncompiled): ID-token signature verification (`OIDCJWS`/`OIDCKeySet`/`IDTokenVerifier`) and its 16 negative tests, the refresh-generation counter, new Admin/Navigation/Analytics/Tasks/Search/Notifications/Media test suites, `SignInFlowTests`, pruned design system, `GeneratedStubsSentinel`. Snapshot **reference images are not recorded**, so the snapshot suite **skips** until the first run of the manual workflow `apple-record-snapshots.yml` (pinned simulator `iPhone 17` / iOS `26.6` and the scheme name are guesses); after that it is strict ([snapshots](/apple/snapshots)). No on-device run of Keychain/App Attest. fastlane lanes and workflows have never run |
| Desktop | **Not built** | Written without a Qt/vcpkg toolchain. This round added file splits, the plugin architecture (ADR-0033), the SQLite outbox and client gate (ADR-0034) and capability negotiation (ADR-0035); none of it has been compiled and the fixture replay tests have never run. First CMake configure/compile is the acceptance test; the CI gates have never executed |

Expect the first real build of Android, Apple and Desktop to surface compile errors, version mismatches and CI gates that need tuning. Record each finding (and the fix) in [decisions.md](/decisions) instead of silently patching, and update this table when a platform passes its first build.

### What can be verified where (the 2026-10-08 authoring machine)

`task doctor` prints this for the machine you are on; `task verify:<platform>` prints the exact commands. The highest level reached on the authoring machine (Windows, Go, Node and pnpm installed; no JDK, Android SDK, Xcode, CMake, vcpkg or Qt):

| Platform | Level reached here | What ran | What cannot run here |
|---|---|---|---|
| Server | tests (unit + integration against embedded Postgres) | `CGO_ENABLED=0 go build ./... && go vet ./... && go test ./...`; `task check:boundaries` | libvips integration (`test:vips:integration`), the CI image job, cluster manifests |
| Web | tests + build + Storybook + e2e | See the table above; repo-wide scripts as listed below | Real IdP, other Playwright projects, visual baselines |
| Android | tests + build (JVM) | Gradle unit tests, debug assemble, lint, ktlint, detekt, repo-wide scripts | Device or emulator runs |
| Apple | static only | Same repo-wide scripts | Everything Xcode-based |
| Desktop | static only | Same repo-wide scripts (read-only) | Everything CMake/Qt-based |

"Static only" means no compiler has seen the code. Passing a repo-wide policy script says nothing about whether the platform builds.

### Exit criteria for "Verified"

A platform moves to **Verified** only when all of these have run on a clean machine or CI runner and passed:

- **Android**: `task android:generate android:lint android:test android:build` (JDK 21).
- **Apple**: `task apple:generate apple:lint apple:test` on macOS with Xcode, plus a simulator launch.
- **Desktop**: `task desktop:build desktop:test` on one preset per OS (`msvc-*`, `gcc-*`; macOS is not a desktop target).

## Profiles

The template is deliberately complete; most products need less. Pick a profile and delete or ignore the rest — the server contract and the shared design tokens do not depend on which clients you keep.

| Profile | Keep | Drop |
|---|---|---|
| **Core** (default for a new product) | `apps/server`, `apps/web`, `docs`, `packages/design-tokens` | `apps/android`, `apps/apple`, `apps/desktop` |
| **Core + mobile** | Core + `apps/android` and/or `apps/apple` | `apps/desktop` |
| **Full** | everything | — |

Infrastructure scales the same way. Start with Docker Compose (`task dev`) and one Postgres. Move to the HA Postgres / Helm / GitOps setup in [deployment](/server/deployment) when you have a production target; none of it is needed to develop.

### Removing a platform

1. Delete `apps/<platform>` and its workflows in `.github/workflows` (`<platform>-*.yml`).
2. Remove its includes and `<platform>:*` tasks from `Taskfile.yml` and from the aggregate `generate`, `lint`, `test`, `build` and `check` tasks.
3. Remove its path from `check:boundaries`, `renovate.json`, `mise.toml` tools that only it needs (for example `java` for Android) and `scripts/update-deps.sh`.
4. Remove its rows from the "Approved stack" tables in [library-first](/library-first) and its section in [decisions.md](/decisions).
5. Keep the server `.proto` contract unchanged; it is shared by every client.

Run `task check` afterwards: naming, boundaries and tooling checks must still pass.

## Repo-wide policy checks

Cheap checks that span all apps; run them with `task check` (individually: `task check:naming|file-size|colors|i18n|boundaries`) and in CI via `policies-ci.yml`. Apps add their own, stricter checks.

| Check | Command | Rule | Configuration |
|---|---|---|---|
| File size | `task check:file-size` | Hand-written source: up to 300 lines green, 301-400 yellow, 401-500 orange (high warning), over 500 red and fails | `scripts/file-size.config`; policy in `CONVENTIONS.md` |
| Color literals | `task check:colors` | No hex/rgb/hsl/oklch/`Color(0x...)`/QML color strings in hand-written UI code; use design tokens. Enforced on every platform including Desktop (`--report-desktop` makes Desktop report-only, for local use) | `scripts/color-literals.allowlist` |
| i18n parity | `task check:i18n` | Same keys and placeholders in en, ru, tg, uz, ar within each platform (`--cross` for the cross-platform report) | `scripts/i18n-parity.allowlist`; [i18n](/i18n) |
| Boundaries | `task check:boundaries` | No feature-to-feature dependency on web, android, apple, desktop; server `architecturetest` | per-app scripts |
| Naming | `task check:naming` | File and directory naming | `CONVENTIONS.md` |

### Findings on 2026-10-08 (working tree, real script output)

- **File size** (`task check:file-size`): no file over 500 lines on any platform (0 red). Orange (401-500): 6 in `apps/server` (`push_test.go` 470, `postgres_integration_test.go` 454, `appattest/application/service_test.go` 452, `config.go` 416, `notifications/infrastructure/postgres/postgres.go` 410, `tasks/infrastructure/postgres/postgres.go` 407) and 2 in `apps/desktop` (`Main.qml` 420, `notifications_view_model.cpp` 410); none in web, android or apple. Yellow (301-400): server 12, web 5, apple 4, desktop 14, android 0.
- **Color literals** (`task check:colors`): `OK: no gating colour literals`; nothing fails on any platform.
- **i18n parity** (`task check:i18n`): `OK`. Web 6 bundles, android 10, apple 9, desktop 8; each with 0 missing keys, 0 extra keys, 0 placeholder mismatches and 0 absent locale files.
- **Boundaries** (`task check:boundaries`): all five platforms pass (web, android, apple and desktop scripts; server `architecturetest`).

These are the results of running the four scripts on the working tree on 2026-10-08. A pass says nothing about whether Apple or Desktop compile.

## Open items after the 2026-10-08 round

Not done (recorded honestly, not hidden):

- Desktop, still open: the hardening flags (`/guard:cf`, `/DYNAMICBASE`, CETCOMPAT, `-fstack-protector-strong`, `-D_FORTIFY_SOURCE=3`, PIE, RELRO) are now set in `cmake/AedstHardening.cmake` and checked by `verify-install-*`, but never compiled or run; replacing the 0600 key-file fallback and unifying the two secret stores (owner decision, ADR-0003 proposal), the Velopack re-hash decision (ADR-0029 proposal), a clang-tidy baseline, and pruning the Desktop UI kit.
- `LICENSE`: the owner must choose one.
- Apple and Desktop have never been compiled; there is no on-device run of Keystore/Tink/AppAuth/Play Integrity/App Attest/Keychain on any platform (Android compiles and passes JVM tests).
- CI workflows `policies-ci` and the server `image` job have never executed on GitHub.
- Apple snapshot baselines and web visual-regression baselines are unrecorded (run `apple-record-snapshots.yml` on GitHub or a Mac; web baselines on the CI runner).
- Two pre-existing lint findings in `apps/server/internal/platform/push/fcm.go` (bodyclose, deprecated `Message.Token`).

Open owner questions:

- **Apple design-system pruning** removed 30 components (kept 18), broader than the five requested (Carousel, MenuBar, HoverCard, CommandPalette, Chart); it includes basics such as Dialog, Select and Tabs. Files are restorable from git HEAD. Confirm or restore.
- **Trivy gate**: the server `image` job fails on fixable HIGH/CRITICAL findings and is part of the `ci` needs, so it blocks merges. Keep it blocking or make it advisory?

## Parity matrix (2026-10-08)

`features.yaml` is the machine-checked source for feature x platform and behaviour x platform status ([parity](/parity)). `task check:features -- --require-complete` passes: 0 behaviour gaps across offline-outbox, idempotency-key, client-identification, forced-upgrade-ux, session-refresh and capability-negotiation. Known deviations: web keeps the refresh cookie on the first `invalid_grant` (15 s multi-replica rotation window); the web `tasks` module is at 479.9 / 480 KB with no headroom; the TV app does not filter features.

## CI evidence

Everything above that says "Verified" was run on the authoring machine. A GitHub Actions run is a different, stronger kind of evidence (clean runner, pinned toolchains), and this table records it separately so the two are never confused.

| Workflow | Observed run on GitHub | Evidence |
|---|---|---|
| `server-ci.yml` (including the `image` job: build, Trivy, Syft SBOM, ghcr push, keyless cosign) | none yet | UNVERIFIED |
| `web-ci.yml`, `admin-ci.yml`, `landing-ci.yml` | none yet | UNVERIFIED |
| `android-ci.yml` | none yet | UNVERIFIED |
| `apple-ci.yml`, `desktop-ci.yml` | none yet | UNVERIFIED; first run is expected to fail and surface the real problems |
| `policies-ci.yml`, `docs-ci.yml`, `tokens-ci.yml` | none yet | UNVERIFIED |

Produce the evidence after the first push and the GitHub settings in `docs/agent/github-setup.md`:

```bash
gh workflow run server-ci.yml
gh run list --limit 20
gh run view <run-id> --log-failed
```

Replace "none yet" with the run URL, the date and the commit SHA, one row at a time. Do not write "Verified" for a workflow until its run is green on a clean runner; a workflow that was only parsed is not evidence.

## Graduation of Apple and Desktop

Apple and Desktop are shipped as code that has been statically reviewed only. Until a platform passes the exit criteria above:

- a new product uses the **Core** profile (`task template:new -- --profile core`), which removes both;
- changes to them are reviewed with the `apple-reviewer` / `desktop-reviewer` subagents and reported as "statically reviewed, never compiled";
- their `features.yaml` status stays `implemented`, never `verified`;
- the first real build is done on its own branch, and every finding is recorded in [decisions.md](/decisions) before the table above is changed.
