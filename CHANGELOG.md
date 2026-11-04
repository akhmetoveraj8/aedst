# Changelog

All notable changes to this repository are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). The project does not publish versioned releases yet, so everything is under Unreleased.

## [Unreleased]

### Changed (Core-first, auth and Desktop, 2026-11-04)

- **Breaking, contract**: first-party authentication is removed (ADR-0019). `aedst/auth/v1/auth.proto` is deleted (`AuthService`: Register, Login, RefreshToken, Logout, GetCurrentUser), as are `AdminService.ListUsers`, its messages and `GetOverviewResponse.users_total`. The server is a pure OIDC resource server; `AEDST_OIDC_ISSUER` and `AEDST_OIDC_AUDIENCE` are required, and `AEDST_AUTH_FIRST_PARTY_*`, `AEDST_JWT_*`, token TTL, login rate limit and session retention variables are gone. Migration `auth/00004` drops `auth.sessions`, `auth.credentials` and the `auth` schema. Every client signs in through the IdP only; the admin user list was removed from web, Android and Apple.
- **Desktop**: the Qt 6 / C++23 app was deleted. `apps/desktop-rs` (Rust + Slint) is the only Desktop. `keyring` was replaced by `keyring-core` with explicit stores, `posthog-rs` was removed (analytics will go through the server), `i-slint-backend-testing` is approved and the first UI tests exist, and Cargo is managed by Renovate. `rusqlite_migration` was evaluated and rejected (rusqlite 0.40 only, no hash freeze).
- **Working mode**: the Core profile (Server + Web) is the default; `task generate|lint|test|build|check` run Core only and `PROFILE=full` adds Android, Apple and Desktop, which are frozen until each has one green CI run. Their workflows are labelled experimental and path-filtered.
- **Android**: Room 2.8.5 → 3.0.3 (`androidx.room3`, not compiled), AGP 9.5.0, KSP 2.3.13. **Server**: River 0.51.0, pgx 5.12.0 and other bumps, `testing/synctest` in the readiness tests. **Web**: Next 16.4.4, Vitest 5.1.0, `@hookform/resolvers` 7, `@dnd-kit/react` pinned at 0.5.3, `standardSchemaResolver` for forms without an RPC, Stryker moved to a nightly workflow. **Apple**: Nuke, GRDB, Sentry and PostHog bumps (not compiled).
- Kept after review and recorded: go-redis with miniredis, `sideshow/apns2`, `sharedtime.Clock`.

### Changed (web split, 2026-10-28)

- `apps/web` is now a pnpm workspace of `shared` (source-only kit, alias `@/shared/*`), `app` (product, :3000), `admin` (staff panel, :3001) and `landing` (marketing site, :3002). Old `apps/web/src/shared/**` is `apps/web/shared/**`; old `apps/web/src/**` and the project config (`e2e`, `lint`, `scripts`, `public`, `deployments`, `.storybook`) are under `apps/web/app/`. Versions live once in the `catalog:` of `apps/web/pnpm-workspace.yaml`; one install, one lockfile, one `biome.json`.
- Tooling follows the split: `task app:*`, `task admin:*`, `task landing:*` next to `web:*` (all three); `admin-ci.yml` and `landing-ci.yml`; `web-ci.yml`, `web-release.yml`, `web-visual.yml`, `web-record-baselines.yml` and the app Dockerfile use the new paths; lefthook has per-project typecheck/knip; the Claude hooks record and lint the touched project; `scripts/check-features.mjs` accepts several web feature roots (app and admin); naming, i18n, color, file-size, docs and boundary checks know the new paths.
- Docs: new `apps/web/AGENTS.md` router, `apps/web/README.md`, `docs/content/web/projects.md`, a decision entry in `decisions/web.md`, Web-app/admin/landing rows in `docs/agent/INDEX.md`.

### Added

- Repo-wide policy checks, wired into `task check`, lefthook (staged files) and the new `policies-ci.yml` workflow:
  - `scripts/check-file-size.sh` with `scripts/file-size.config` (green up to 300 lines, yellow 301-400, orange 401-500, red over 500 fails).
  - `scripts/check-color-literals.mjs` with `scripts/color-literals.allowlist` (desktop is report-only).
  - `scripts/check-i18n-parity.mjs` with `scripts/i18n-parity.allowlist` (en, ru, tg, uz, ar; `tj` on web is normalized to `tg`).
  - `scripts/check-boundaries.sh`, one entry point over the four app scripts and the server `architecturetest`.
- `task doctor` (`scripts/doctor.sh`) and `task verify:<platform>`.
- Design tokens `info` and `infoForeground` (light and dark); `success` and `warning` already existed. Generated web, Android, Apple and Desktop outputs regenerated.
- `docs/agent/INDEX.md` (agent routing), `docs/agent/rules.md` (full rules), `docs/agent/conventions/<platform>.md` and `tooling.md`.
- Root `CLAUDE.md` (imports `AGENTS.md`), `.gitattributes` (`* text=auto eol=lf`, no renormalization), `docs/archive/AGENTS.md` and `README.md` ("do not read" notice).
- Docs: UI kit component parity matrix, repo-wide policy checks and a per-platform verification table in `status.md`, the Tajik `tj`/`tg` convention and parity script in `i18n.md`, a decision row stating that the server is not a design-token target.

### Changed

- `AGENTS.md` shortened to an entry point; the previous full text moved to `docs/agent/rules.md`.
- `CONVENTIONS.md` translated fully to English, split into a short root file (naming summary, file-size policy, checklist) and per-platform files. The embedded copy of `check-naming.sh` was dropped in favor of the real script. The Apple ViewModel row now states `@Observable` instead of `ObservableObject`, matching the repo's native-Observation decision.
- `docs/content/library-first.md` and `docs/content/decisions.md` split into short indexes plus per-platform topic pages (`library-first/<platform>.md`, `library-first/general.md`, `decisions/<platform>.md`, `decisions/cross-cutting.md`); content preserved, links to the old anchors updated.
- `docs/content/ui-kit.md`: tokens are described as generated from `packages/design-tokens` (web is not their source of truth); counts of kits and READMEs corrected.
- `mise.toml`: `lefthook` 2.2.0, `ninja` 1.13.2 and `golangci-lint` 2.14.0 pinned (verified against GitHub releases on 2026-10-08). `tuist` stays `latest`, marked UNVERIFIED.
- `.gitignore`: `*.tsbuildinfo`, `coverage.out`, `.claude/worktrees/`.
- `task check` now aggregates naming, file size, color literals, i18n parity, boundaries, knip, migration lint, tokens and infra format.

### Added (2026-10-08 round: web, server, android, apple)

- Web: Storybook 10 (devDependencies `storybook`, `@storybook/nextjs-vite`, `@storybook/addon-a11y`, `@storybook/addon-vitest`, all `^10.6.1`): 62 stories, light/dark and RTL toolbar, a11y violations fail. Opt-in visual regression (`test:visual`, baselines not recorded). File-size gate (`scripts/check-file-size.mjs`, Biome `noExcessiveLinesPerFile(500)`) and colour-literal gate (`scripts/check-color-literals.mjs`). Env var `E2E_WEB_PORT` (default 3100).
- Server: `architecturetest/filesize_test.go` and `layers_test.go` (domain/application import rules for all 8 modules); 20 new domain unit tests; CI `image` job (build, Trivy gate, Syft SBOM, ghcr push and keyless cosign on `main` / `server-v*`); no-cgo build/vet step; `test:vips:integration` task.
- Android: `androidx.compose.material3.adaptive` 1.3.0 (list-detail for tasks); tests for admin, media, notifications and tasks ViewModels, sync, security, datastore, ui-tv; `scripts/check-color-literals.sh` and `scripts/check-file-size.sh` in `check-policies.sh`; `TaskStatus.UNKNOWN` / `TaskPriority.UNKNOWN`.
- Apple: ID-token signature verification (`OIDCJWS`, `OIDCKeySet`, `IDTokenVerifier`) with 16 negative tests; test suites for Admin, Navigation, Analytics, Tasks, Search, Notifications, Media and a `SignInFlowTests` UITest; snapshot variants (iPhone light/dark/xxxl/RTL, iPad, macOS); colour and file-size scripts, SwiftLint `file_length` / `type_body_length`, `make doctor`, `GeneratedStubsSentinel`.

### Changed (2026-10-08 round)

- Web: GraphQL removed entirely (Connect-RPC only); the CSP is built only in `src/proxy.ts` (removed from `next.config.ts`, also covers `/api/*` and `/serwist/*`); `sidebar.tsx` split into `src/shared/ui/sidebar/`; e2e mock-api handlers split into modules; the only real `any` replaced by `unknown`; `shadcn` CLI moved to devDependencies; knip ignores removed for recharts, embla-carousel-react, react-day-picker, input-otp, react-resizable-panels, `@shadcn/react`, `use-mobile.ts`; a11y fixes found by stories (slider thumb label, combobox trigger tabindex, invalid `role=list`). The bundle budget was not raised.
- Server: `cmd/server/main.go` 736 to 144 lines (wiring in `wire_*.go`).
- Android: exhaustive enum mappers; JUnit 6 Jupiter migration (about 33 files), `junit:junit` removed, vintage engine kept only where Robolectric / Compose rules require it (supersedes "JUnit 4 stays"); 21 `core/ui` components pruned; `AedstAlert` uses success/warning tokens.
- Apple: the "ID-token signature not verified" decision is replaced by verification; a refresh-generation counter discards a refresh that finishes after sign-out; 30 design-system components pruned (18 kept; broader than the five requested, owner to confirm).
- Docs: decisions, library-first, `status.md` and `ui-kit.md` updated to match.

### Verification of this round

- Verified by running: web typecheck, Biome, knip, unit (278), browser (184), Storybook (177, twice) and `build-storybook`, `next build`, bundle budget, Playwright chromium 101/101 in CI mode; server `CGO_ENABLED=0 go build ./... && go vet ./... && go test ./...`; repo-wide `check-boundaries`, `check-naming`, `check-color-literals`.
- Not verified (at the time of this round; Android was later verified on the JVM, see `docs/content/status.md`): Android and Apple were **not compiled**; the CI `image` job and `policies-ci` never ran on GitHub; Apple snapshot baselines and web visual baselines are not recorded; no on-device run of Keystore/Tink/AppAuth/Play Integrity/App Attest/Keychain.
- At the time of this round `check-i18n-parity` failed on 18 Desktop entries; this is fixed (`task check:i18n` passes).

### Not done this round

- Everything in `apps/desktop` (hardening flags, key-file fallback and unified secret stores, updater install path, clang-tidy baseline, colour/i18n/file-size findings, UI kit pruning); `LICENSE` (owner must choose); two pre-existing lint findings in `apps/server/internal/platform/push/fcm.go`; go-redis was not migrated to valkey-go (kept, `redis_rate` has no equivalent).
- Open owner questions: the Apple pruning scope; whether the Trivy gate should block merges.

### Known gaps (not fixed here)

- Apple and Desktop have never been compiled or built; Android is verified on the JVM only; see `docs/content/status.md`.
- File size, colour literals and i18n parity: see the current findings in `status.md` (no file over 500 lines, no gating colour literals).
- No `LICENSE` file: the owner has not chosen a license.
