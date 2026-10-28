# AEDST

An empty, AI-friendly project template: a Go backend and four clients in one monorepo, built around one principle — **monolith first, boundaries first, microservices later**. It ships only global modules (auth, tasks as the worked example, search, notifications, media, admin). Product domains are added by each product, never by the template.

| App | Stack | Verified |
|---|---|---|
| [`apps/server`](apps/server/README.md) | Go, net/http ServeMux, ConnectRPC, Postgres (pgx/sqlc/Goose), River, Valkey, OpenTelemetry | built, vetted, unit-tested |
| [`apps/web`](apps/web/README.md) (`app`, `admin`, `landing`, `shared`) | Next.js 16, React 19, TanStack Query, shadcn/ui, next-intl | typechecked, linted, unit-tested |
| [`apps/android`](apps/android/README.md) | Kotlin, Jetpack Compose, Hilt, connect-kotlin | verified on JVM (unit, assembleDebug, lint, ktlint, detekt); device runs unverified |
| [`apps/apple`](apps/apple/README.md) | SwiftUI, GRDB, connect-swift, Tuist (iOS 18+, macOS 15+) | **not built** |
| [`apps/desktop`](apps/desktop/README.md) | C++23, Qt 6, vcpkg, protoc-generated Connect client | **not built** |

Server and Web are the working core. Android is verified on the JVM only (never run on a device). Apple and Desktop were written and reviewed without their toolchains, and their first real build is their acceptance test. See [Platform status](docs/content/status.md) before building on them, including the minimal profile for projects that only need Server + Web.

## For AI agents and contributors

Start at [`docs/agent/INDEX.md`](docs/agent/INDEX.md), which routes you to only the files that apply. In order:

1. [`AGENTS.md`](AGENTS.md): the rules in one page.
2. [`CONVENTIONS.md`](CONVENTIONS.md): naming summary and the file-size policy (per-platform tables in `docs/agent/conventions/`; `scripts/check-naming.sh` enforces naming).
3. [`docs/content/library-first.md`](docs/content/library-first.md): the approved stack and the order of preference (standard library → platform API → existing dependency → approved library → custom code).
4. [`docs/content/decisions.md`](docs/content/decisions.md): decisions with rationale and "revisit when". Do not re-propose what is recorded there.
5. The `AGENTS.md` of the app you touch.

## Getting started

Prerequisites: [mise](https://mise.jdx.dev) (pins Go, Node, pnpm, buf, sqlc, Task, golangci-lint, JDK and others in [`mise.toml`](mise.toml)) and Docker (local Postgres and Valkey). Qt, vcpkg, Xcode and the Android SDK are installed separately, only if you work on those apps.

```bash
mise install        # pinned toolchains
task setup          # git hooks, web + docs dependencies, code generation
task dev            # Postgres + Valkey + server (in another shell: task web:dev)
```

`task` is the single entry point; run `task --list` for everything. The common ones:

| Command | What it does |
|---|---|
| `task generate` | buf/sqlc outputs (generated code is never committed) |
| `task lint` / `task test` / `task build` | every platform whose toolchain is installed |
| `task check` | naming, file size, color literals, i18n parity, boundaries (all five platforms), knip, migration lint, design tokens |
| `task doctor` / `task verify:<platform>` | which toolchains this machine has; exact verification commands |
| `task deps:check` / `task deps:update` | outdated dependencies, latest stable only |

Commands per app (for example `task server:test`, `task web:test`) are listed in `task --list`.

<!-- template:begin -->
## Using this repo as a template

1. Once, on GitHub: Settings > General > tick **Template repository**.
2. Create the product repository: `gh repo create <org>/<product> --template <org>/aedst --private --clone`.
3. Pick a profile and rename the external identifiers. Always look first: `task template:new -- --name "<Brand>" --profile core --dry-run`, then run it for real with `--in-place` (needs a clean git tree) or `--out <dir>` (writes a new directory).

   | Profile | Keeps | Removes |
   |---|---|---|
   | `core` | server + web | android, apple, desktop |
   | `mobile` | core + android + apple | desktop |
   | `full` | everything | nothing |

   Removal is declared in [`scripts/template-profiles.json`](scripts/template-profiles.json): `apps/<platform>`, workflows, docs, Taskfile tasks, renovate rules, lefthook commands, CODEOWNERS, INDEX rows, `features.yaml`, `file-size.config`, the i18n allowlist and the `check-docs` allowlist. Renamed: display name, Android `applicationId`, Apple bundle prefix, Velopack/Flatpak id, Helm chart and image names, domains (`*.example`, `.com`, `.dev`, `.app`), the session cookie name. Not renamed: proto packages `aedst.*`, the Go import path, `Aedst*` types, the QML URI and the `AEDST_` environment prefix (see [decisions](docs/content/decisions/cross-cutting.md)). Options: `--org`, `--domain`, `--keep-tool`.
4. `git branch -m master main` if your default branch is `master` (the workflows trigger on `main`), then `task setup` and `task doctor`, then `task check`.
<!-- template:end -->

## Layout

```
apps/        server, web, android, apple, desktop
packages/    design-tokens (Style Dictionary; generated token files are never hand-edited)
docs/        documentation site (Next.js + Nextra), content in docs/content
scripts/     check-naming.sh, check-file-size.sh, check-color-literals.mjs, check-i18n-parity.mjs, check-boundaries.sh, doctor.sh, update-deps.sh
```

Architecture: [backend](docs/content/server/architecture.md), [modules](docs/content/server/modules.md), [web](docs/content/web/architecture.md), [Android](docs/content/android/architecture.md), [Apple](docs/content/apple/architecture.md), [Desktop](docs/content/desktop/architecture.md). Run the documentation site with `pnpm --dir docs dev`.
