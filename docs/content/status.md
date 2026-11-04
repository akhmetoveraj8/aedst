---
title: "Platform status and profiles"
description: "What has actually been run, which platforms are Core and which are frozen, and which parts of the template a project needs."
---

# Platform status and profiles

What has actually been run, and which parts of the template a project needs. Read this before building on a platform: "Accepted" in [decisions.md](/decisions) records a *decision*, not that the code builds.

## Working mode: Core first

**Core = Server + Web** is the default. `task generate|lint|test|build|check` run Core only; `PROFILE=full` adds the frozen platforms. Android, Apple and Desktop are **frozen**: bug fixes and the work already scoped in their own tasks only, no new features, until each has had one green CI run on a clean GitHub runner. The rule exists because a feature costs about five times more when it must land on five clients and only two clients are verified.

A frozen platform is unfrozen by recording its first green run in "CI evidence" below. Nothing else unfreezes it.

## Verification status

Dates are 2026-11-04 unless stated. "Verified" means run on the authoring machine; GitHub runs are recorded separately under "CI evidence".

| Platform | Status | Evidence |
|---|---|---|
| Server | **Verified** (build, vet, unit tests, architecture test, golangci-lint) / **UNVERIFIED** (integration tests since the auth removal, migration `00004`, image CI job, cluster, `buf breaking`, govulncheck) | `CGO_ENABLED=0 go build ./... && go vet ./... && go test -short ./...` pass; `golangci-lint run ./...` reports 0 issues. First-party auth was removed (ADR-0019): the server is a pure OIDC resource server and requires `AEDST_OIDC_ISSUER` and `AEDST_OIDC_AUDIENCE`. Docker is not available on the authoring machine, so integration tests compile (`go vet -tags integration`) but did not run; they now sign in through an in-process OIDC provider (`internal/platform/auth/authtest`). River was bumped to 0.51.0 (whether it needs a new River schema migration is **UNVERIFIED**). Helm, CloudNativePG and Argo CD manifests are not verified against a cluster |
| Web | **Verified** (typecheck, Biome, knip, unit and browser tests, `next build`, bundle budget) / **UNVERIFIED** (real IdP, Playwright e2e and Storybook after the 2026-11-04 bumps, visual baselines) | app: 481 unit and 216 browser tests; admin: 73 unit and 26 browser; landing: 38. Browser tests were flaky under load and passed on rerun. Bundle `/tasks/[id]` first load is **479.0 of 490 KB**, largest chunk 101.8 of 110 KB, total JS 854.7 of 905 KB; the budget was not raised and headroom did not improve. The web sign-in is Authorization Code + PKCE (`oauth4webapi`) and has **never been run against a real ZITADEL** |
| Android | **Frozen.** Last full JVM run (ktlint, detekt, lint, unit tests, assemble) predates the 2026-11-04 changes / **UNVERIFIED** (Room 3 migration, AGP 9.5.0, KSP 2.3.13, device) | Policy scripts pass (`check-policies`, `check-feature-boundaries`, `check-room-schemas`). Gradle did not run on 2026-11-04 (a build-cache lock was held by another process). Room 2.8.5 → 3.0.3 (`androidx.room3`, `AndroidSQLiteDriver`) is written but **not compiled**; the committed schema hash may need regenerating. Admin user list removed. Never run on a device |
| Apple | **Frozen. Not built** (UNVERIFIED) | Nothing compiled. Sign-in is browser-only (`ASWebAuthenticationSession`); password mode and the admin user list were removed without a compiler. Static scripts pass (`check-feature-boundaries`, `check-apple-swift-policy`). Snapshot reference images are not recorded. Never run on a device |
| Desktop (`apps/desktop-rs`) | **Frozen. Windows only** | Rust 1.99.1, Slint 1.18.1: `cargo fmt --check`, `cargo clippy --workspace --all-targets -- -D warnings`, `cargo test --workspace` (377 passed) and `cargo deny check` pass on Windows. UI tests use `i-slint-backend-testing`. **Never built on Linux**, never run against a real server or IdP, Velopack update path and packaging unverified, no screen-reader pass, no Linux accessibility check. The Qt 6 / C++ app was deleted on 2026-11-04 (it had never been compiled) |

Expect the first real build of Android, Apple and Desktop-on-Linux to surface compile errors, version mismatches and CI gates that need tuning. Record each finding (and the fix) in [decisions.md](/decisions) instead of silently patching, and update this table when a platform passes its first build.

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
| **Core** (default, and the working mode of this repo) | `apps/server`, `apps/web`, `docs`, `packages/design-tokens` | `apps/android`, `apps/apple`, `apps/desktop-rs` |
| **Core + mobile** | Core + `apps/android` and/or `apps/apple` | `apps/desktop-rs` |
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
| Boundaries | `task check:boundaries` | No feature-to-feature dependency on web, android, apple; server `architecturetest`. Desktop crate boundaries have no script yet | per-app scripts |
| Naming | `task check:naming` | File and directory naming | `CONVENTIONS.md` |

<!-- metrics:start (generated by scripts/status-metrics.mjs; do not edit) -->

File-size policy counts (`task check:file-size`, hand-written source only):

| Platform | Files | Yellow (301-400) | Orange (401-500) | Red (over 500) |
|---|---|---|---|---|
| server | 286 | 11 | 6 | 0 |
| web | 672 | 6 | 0 | 0 |
| android | 399 | 0 | 0 | 0 |
| apple | 297 | 3 | 0 | 0 |
| desktop | 244 | 15 | 4 | 0 |
| root | 61 | 2 | 0 | 0 |

<!-- metrics:end -->

A pass of these scripts says nothing about whether Apple, Android or Desktop compile.

## Changes on 2026-11-04 (owner decisions)

- **Qt 6 / C++ Desktop deleted.** `apps/desktop-rs` (Rust + Slint) is the only Desktop; the directory keeps its name (ADR-0001 in `apps/desktop-rs/docs/adr/` was amended).
- **First-party auth removed** from the server and from every client (ADR-0019). Clients sign in through the IdP only. `AdminService.ListUsers` and `users_total` were removed with it because they read the deleted table; the admin clients dropped the user list.
- **Core-first profile** is the working mode (above).
- **Dependencies** brought to the latest stable verified on each registry; exceptions are recorded in each platform's decisions page (detekt 2.0.0-alpha.6 has no stable release, `posthog-js` held at 1.440.0 for bundle size, `connectrpc` pinned exactly, `rand_core` 0.6 for `rsa` 0.9).
- **Kept after review**: go-redis (with miniredis for tests), `sideshow/apns2` (FCM for iOS would need the Firebase iOS SDK; revisit conditions are in the server decisions), the `sharedtime.Clock` abstraction beside `testing/synctest`, and the hand-written SQLite migrator on Desktop (`rusqlite_migration` needs rusqlite 0.40 while the workspace is on 0.41 and it has no hash freeze).
- **Desktop telemetry**: `posthog-rs` removed. Product analytics will go through the Go server; the server has no ingest RPC yet, so the Privacy switch is disabled and the RPC is a recorded follow-up.

## Open items

Not done (recorded honestly, not hidden):

- Run the integration tests against Postgres (Docker) after the auth removal; check `buf breaking` and `govulncheck`; confirm River 0.51's schema migration.
- Compile Android (Room 3, AGP 9.5.0) and regenerate the Room schema if the identity hash changed.
- Apple and Desktop-on-Linux have never been compiled/built; no on-device run of Keystore/Tink/AppAuth/Play Integrity/App Attest/Keychain on any platform.
- Desktop: four `zip` advisories (RUSTSEC-2026-0367/0368/0369/0429) arrive through `velopack` and are ignored in `deny.toml` with a written reason; whether Velopack reaches the affected code is UNVERIFIED. Four transitive crates behind Slint are marked unmaintained.
- Desktop: no `aedst-feature-auth` crate (auth lives in `aedst-oidc`, declared exception); `client-identification` and `forced-upgrade-ux` have no replay test of `client-version-gate.json`; the Slint Royalty-free licence terms need the owner's confirmation before release.
- Web bundle: `/tasks/[id]` still has about 1 KB of headroom; lazy date-fns locales (about 10 KB) are the next candidate.
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
| `apple-ci.yml`, `desktop-rs-ci.yml` | none yet | UNVERIFIED; the first run is expected to fail and surface the real problems |
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
