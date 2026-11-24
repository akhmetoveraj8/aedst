## What / Why

A full audit of the template against the owner's goals, then the changes that close the gaps it found.
One structure on every platform (module, then feature), one UI kit on every client, the roadmap.sh
performance, SEO and API design checklists turned into gates, and the dependency refresh.

- **Server**: `tasks` split into features (`core`, `completion`, `reminders`, `operator`) with
  architecture tests on real code and an extraction test; `task new:feature`; `cache.Aside` with a
  reference use; pgx slow-query tracer; allocation, N+1 and `SELECT *` gates; blocking k6 smoke;
  OpenAPI per package; `problem+json`; typed error details; OAuth scopes in the policy; conditional
  reads; per-procedure rate limits; a `webhooks` module (off by default); Protobuf event contracts
  for `tasks`; PostgreSQL 19.
- **Web**: every file kebab-case; `tasks` split into features; boundaries gated in `app`, `admin`
  and `landing`; `shared/ui` at 61 components (adds `trace`, `code-block`, `data-table`,
  `date-picker`, `sonner`, `typography`); bundle, font, Lighthouse, axe, rendered-SEO, RTL and
  base64 gates for `landing` and `admin`; landing client JS cut (first load 223.5 to 136.7 KB);
  oversized session cookies are chunked; `admin` serves `robots.txt`; landing `og:url` is the page
  canonical.
- **Android** (owner exception to the freeze): Kotlin 2.5.0-RC; `core/common`, five feature domain
  modules and `core/database` are Kotlin Multiplatform (android and jvm targets, no iOS target);
  `core/ui` has the 61 manifest components; English is the default locale.
- **Apple** (owner exception): each feature is split into Domain, Data, Presentation and separate
  `UIiOS` / `UIMac` targets; the design system has the 61 manifest components.
- **Desktop and Gateway** (owner exception): `aedst-ui` has the 61 manifest components; crate
  boundary and approved-crate gates that run without cargo; the gateway no longer echoes the token,
  fails closed on origins, has a header timeout and connection caps, and its consumer reconnects.
- **Docs and tooling**: `docs/content/modules/<module>` with API reference and interactive OpenAPI;
  `ui-kit.yaml` with a checker for files, variants and sizes on all four clients; roadmap coverage,
  accessibility and SEO-by-project pages; decisions of 2026-11-21.

## Spec / ADR

- Decisions: `docs/content/decisions/cross-cutting.md` (module then feature, UI kit manifest,
  kebab-case, roadmap coverage), `server.md` (PostgreSQL 19, webhooks secret storage, `buf breaking`
  exemption), `web.md` (naming, Sentry and posthog-js holds), `android.md` (Kotlin 2.5.0-RC, KMP),
  `apple.md` (one logic, two UI builds), `desktop.md`.
- `docs/content/architecture/modules-and-features.md`, `docs/content/engineering/checklists.md`,
  `apps/server/specs/webhooks/`.
- ADR-0020 carries an amendment note: a feature is now a slice inside a module, not a unit with its
  own API and schema. **Needs the owner's confirmation.**

## Verification (honest)

Ran on the authoring machine (Windows, no Docker, no cargo, no Xcode):

- **Server**: `go build`, `go vet` (also `-tags integration`), `go test -short ./...` (73 packages),
  `golangci-lint` (0 issues), `buf lint`, `buf breaking` against a `git archive` of main, `sqlc`
  and OpenAPI drift checks, `govulncheck`.
- **Web**: typecheck, Biome, knip, unit tests (app 506, admin 8, BFF 97, landing 39), browser tests
  (app 222, admin 31), three builds, bundle budgets, Chromium e2e (app 97, landing 25, admin 21),
  Lighthouse CI for app and landing.
- **Android**: `core/common`, the five domain modules, `core/database` and `core/ui` compile and
  their tests pass (android and jvm targets where applicable).
- **Repo checks**: naming, file size, colours, i18n parity, boundaries (0 skipped), docs, features,
  UI kit, API reference drift.

**NOT verified:**

- Nothing ran against PostgreSQL 19, River tables, DragonflyDB or a real IdP; no webhook was delivered.
- Android `feature/*`, `core/capabilities`, `core/media`, `app` and `app-tv` were edited but **not
  compiled**: they need compileSdk 37.1 (SDK download) and generated Connect clients (`buf generate`).
- **Apple, Desktop and the Gateway were not compiled at all.** Expect compile errors on the first run.
- No workflow in this repository has ever run on GitHub; this PR is their first run.
- Pre-commit hooks and gitleaks were not installed on the authoring machine.

## Reviewer notes

- Commit boundaries are approximate: file renames for web and Apple landed in the first (server)
  commit because they were already staged. Review the branch as a whole.
- Kotlin 2.5.0-RC is a pre-release pin by owner decision; `core/database` uses the Beta
  `-Xexpect-actual-classes` flag for Room on KMP (needs a decision row confirmation).
- `GetCapabilities` is now `NO_SIDE_EFFECTS`; one scoped `buf breaking` exemption covers it and
  should be removed once main contains the change. Android, Apple and Desktop must regenerate
  clients for it and for `aedst.tasks.events.v1`.
- The CI `load` job needs `LOAD_OIDC_*` variables and a secret; without them it skips k6.
- Gateway deployments must list browser origins in `AEDST_GATEWAY_ALLOWED_ORIGINS`.
- Not bumped: Rust crates (no `Cargo.lock` regeneration here), PostHog 4 on Android and Apple,
  `@testing-library/jest-dom` 8.

## Shared checklist (every PR)

- [ ] `task check` is green locally (`task` is not installed here; the underlying scripts were run and pass)
- [x] Every new or changed version was verified against its registry, or is marked `UNVERIFIED`
- [x] New dependencies are on the platform allowlist and the Library-First pages are updated
- [x] No hand-edited generated files
- [x] Decision changes are recorded on the decision pages (ADR-0020 amendment awaits the owner)
- [x] Docs updated; everything new is in English
- [x] User-facing strings exist in all five locales (tg, uz and ar strings added for the Apple kit are unreviewed translations)
- [ ] No unrelated changes bundled from other apps (this PR deliberately spans all apps)
- [x] Verification claims are honest (see above)

🤖 Generated with [Claude Code](https://claude.com/claude-code)
