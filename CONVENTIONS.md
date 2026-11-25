# AEDST Naming & Conventions Standard

Single source of truth for naming and file-size limits across the 5 AEDST platforms: **Web** (TypeScript/React), **Server** (Go), **Android** (Kotlin), **Apple** (Swift/SwiftUI), **Desktop** (Rust/Slint). This root file is short on purpose; the per-platform rule tables live next to it and you only need to open the one for the platform you touch.

## For AI code generation (mandatory)

> **Any AI agent (Claude or otherwise) generating, renaming, or reviewing code in this repository MUST apply these rules without being asked.** A rule marked **Must** is enforced by a linter or CI script; violating it is a defect, not a style preference, and is treated like a compile error. When creating a file, function, type, or resource, resolve its name against the matching table row *before* writing it. If a rule conflicts with a framework requirement (e.g. Next.js forces `page.tsx`), the framework wins for the *file name*, but the naming rule still applies to the exported symbol inside it.

## Strictness levels

| Level | Meaning |
|---|---|
| **Must** | Enforced by a linter or CI script. A PR with a violation is blocked. |
| **Should** | Strong convention. Deviating needs a one-line justification in the PR description. Not machine-enforced everywhere. |
| **Could** | Preference/idiom. Follow by default; no gate. |

## Per-platform naming tables

| Platform | Rules | Linter / script |
|---|---|---|
| Web (`apps/web`: `shared`, `app`, `admin`, `marketing`) | [docs/agent/conventions/web.md](docs/agent/conventions/web.md) | Biome, `scripts/check-naming.sh` |
| Server (`apps/server`) | [docs/agent/conventions/server.md](docs/agent/conventions/server.md) | golangci-lint, `architecturetest`, `scripts/check-naming.sh` |
| Android (`apps/android`) | [docs/agent/conventions/android.md](docs/agent/conventions/android.md) | ktlint + detekt, `scripts/check-naming.sh` |
| Apple (`apps/apple`) | [docs/agent/conventions/apple.md](docs/agent/conventions/apple.md) | SwiftLint + swift-format, `scripts/check-naming.sh` |
| Desktop (`apps/desktop`) | [docs/agent/conventions/desktop.md](docs/agent/conventions/desktop.md) | rustfmt + clippy, `scripts/check-naming.sh`, `apps/desktop/scripts/check-feature-boundaries.sh` |
| Gateway (`apps/gateway`) | [docs/agent/conventions/gateway.md](docs/agent/conventions/gateway.md) | rustfmt + clippy, `scripts/check-naming.sh`, `apps/desktop/scripts/check-approved-crates.sh` |
| Linter config shapes, wiring | [docs/agent/conventions/tooling.md](docs/agent/conventions/tooling.md) | |

Cross-platform summary (details and rationale in the per-platform files):

| Thing | Web | Server | Android | Apple | Desktop |
|---|---|---|---|---|---|
| File | `kebab-case.ts` / `kebab-case.tsx` (components too) | `snake_case.go` | `PascalCase.kt` | `PascalCase.swift` | `snake_case.rs` / `snake_case.slint` |
| Type | `PascalCase` | `PascalCase` (exported) | `PascalCase` | `PascalCase` | `PascalCase` |
| Function / variable | `camelCase` | `camelCase` / exported `PascalCase` | `camelCase` | `camelCase` | `camelCase` |
| Constant | `SCREAMING_SNAKE_CASE` (module config) | `PascalCase` | `SCREAMING_SNAKE_CASE` | `camelCase` | `SCREAMING_SNAKE_CASE` |
| Enum value | n/a (union types) | `PascalCase` consts | `SCREAMING_SNAKE_CASE` | `camelCase` | not specified (see desktop.md) |
| Test file | `x.test.ts(x)` | `x_test.go` | `XTest.kt` | `XTests.swift` | `tests/<subject>.rs` |

## Language policy (Must, repo-wide)

English only. Rule documents, specs, ADRs, README files, code comments, identifiers, commit messages, PR text and CI/workflow files are written in English. Russian (and other non-English text) is allowed only in `docs/archive/` and in locale/translation resources (`i18n` directories, `strings.xml` locale folders, `*.xcstrings`, `*.lproj`, gettext `*.po` catalogs, test fixtures that exercise a locale). Non-English text anywhere else is a defect: translate it.

## File size (Must, repo-wide)

Measured in physical lines of **hand-written** source. Generated, vendored, lock and data files are excluded in `scripts/file-size.config` (never by silently skipping them in code).

| Lines | Level | Meaning |
|---|---|---|
| 1-300 | green | Fine. |
| 301-400 | yellow | Consider splitting; do not grow it further without reason. |
| 401-500 | orange (high warning) | Split when you next touch the file; a PR that grows such a file needs a justification. |
| over 500 | red | **Fails the check** (exit 1). Split before merging. |

- Repo-wide net: `scripts/check-file-size.sh` (`task check:file-size`; lefthook pre-commit on staged files; the `policies-ci.yml` workflow). Limits and excludes: `scripts/file-size.config`.
- Apps may add stricter per-app checks (e.g. `apps/server/architecturetest/filesize_test.go`); the repo-wide limits are the floor.
- The right fix is to split along a real seam (responsibility, feature, layer), not to move lines into `utils`. Tests are measured like everything else; split by scenario group.
- Do not add a file to the excludes to make the check pass. Excludes are for generated or vendored files only.

## Other repo-wide policy checks

| Check | Command | What it enforces |
|---|---|---|
| Naming | `task check:naming` | File/directory names (this document) |
| File size | `task check:file-size` | The table above |
| Color literals | `task check:colors` | No hex/rgb/hsl/oklch literals in hand-written UI code; use design tokens |
| i18n parity | `task check:i18n` | Same keys and placeholders in en/ru/tg/uz/ar on each platform |
| Module boundaries | `task check:boundaries` | No feature-to-feature imports on Server, Web, Android, Apple and Desktop (Desktop: `apps/desktop/scripts/check-feature-boundaries.sh`, bash + node, no cargo: crate boundaries, feature layout and the approved-crate list, with negative self-tests; per-crate `tests/layers.rs` checks the layers when cargo runs) |
| Web import graph | `bash apps/web/app/scripts/check-feature-boundaries.sh <project-dir>` (`task check:boundaries` for all three projects), Biome `noImportCycles`, knip | app -> modules -> shared, public entry only, no feature to feature (boundary script); no cycles (Biome); no unused or orphan files (knip) |
| Audit backlog | `task audit:status` | Every item of `docs/audit/2026-10-08-backlog.md` has a valid status, none `skipped` (`scripts/check-backlog.mjs`) |
| Library-First gates | `task check:gates` (+ platform lint) | Mandatory library per concern; each gate has a negative self-test. Per-platform list: `docs/agent/conventions/tooling.md` |

## Review checklist

1. Does the file name match the table of its platform (or a framework exception documented there)?
2. Is the component/class/type name `PascalCase`, and does the file carry the same name where required (Kotlin, Swift; a Web component file is the kebab-case form of the component name)?
3. Are functions/variables `camelCase`, with no Hungarian notation (`IFoo`, `m_foo` outside the agreed style)?
4. Are role suffixes in place: `ViewModel`/`UseCase` (Android/Apple), `<Transport><Name>Repository` for implementations (`ConnectTaskRepository`, `OidcAuthRepository`; never `*Impl`) with the bare `<Name>Repository` for the interface, `deliver` for the outbox handler method, `<Behavior>ReplayTest(s)` plus a `BehaviorFixture` loader for contract replays, `*Page`/`*Layout` (Web), `Err*` (Go)?
5. Are constants in the platform's style (`SCREAMING_SNAKE_CASE`; `PascalCase` in Go; `camelCase` in Swift)?
6. Does Go export visibility match the intent (external access means `PascalCase`)?
7. Do enum values follow the platform standard (Kotlin `SCREAMING_SNAKE_CASE` vs Swift `camelCase` is deliberate)?
8. Are JSON/protobuf fields `camelCase` at the API boundary (except `.proto` sources, which use `snake_case`)?
9. Are test files/functions named per platform convention and placed where expected?
10. Is every file at or under 500 lines (ideally 300)?
11. If a rule is broken on purpose (migration, legacy), is there a comment or PR note rather than a silent deviation?
