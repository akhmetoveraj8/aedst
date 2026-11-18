# AEDST — AI agent instructions

Start at **[docs/agent/INDEX.md](docs/agent/INDEX.md)**. It routes you to the few files that apply to your platform and task; do not read the whole docs tree. Full text of these rules: [docs/agent/rules.md](docs/agent/rules.md).

Always applicable:

1. **[CONVENTIONS.md](CONVENTIONS.md)**: naming for the 5 platforms (Web, Server, Android, Apple, Desktop) and the file-size policy. **Must** rules are enforced by linters and `scripts/check-naming.sh`.
2. **[docs/content/library-first.md](docs/content/library-first.md)**: Library-First standard; platform stack pages are linked from it.
3. **[docs/content/decisions.md](docs/content/decisions.md)**: decisions with rationale and "revisit when". If a proposal contradicts one, do not implement or re-propose it.
4. **[docs/agent/quality-bar.md](docs/agent/quality-bar.md)**: the senior-level bar (modern features of the pinned toolchain, API design, security, performance); full pages in `docs/content/engineering/`. Run the `quality-pass` skill before reporting a change done; start API work with the `api-design` skill.
5. The `AGENTS.md` of the app you touch (`apps/server`, or `apps/web` and then the one web project `app` / `admin` / `landing` you work in, see [docs/content/web/projects.md](docs/content/web/projects.md)) and platform ADRs (`apps/server/docs/adr/`, `apps/desktop/docs/adr/`).

## The one rule that matters most

**Do not write code that an existing library or platform already does.** Before creating a utility, hook, component, service, repository, parser, formatter, validator or other abstraction, check in this order: standard library, platform API, libraries already in this repo's `package.json` / `go.mod` / `build.gradle.kts` / `Package.swift` / `Cargo.toml`, existing code in this repo. Write custom code only for a documented technical reason (missing functionality, unsupported platform, incompatible API, unacceptable performance, security/compliance, project-specific domain logic), never "it is simpler to write myself" or "it is only 50 lines".

Approved stack per platform: Web (React Hook Form, Zod, date-fns, dnd-kit, shadcn/ui via `apps/web/shared/ui/`, TanStack, nuqs, Biome only), Server (net/http ServeMux, ConnectRPC + Protobuf + Buf, pgx + sqlc + Goose, River, Valkey, jwx, OpenTelemetry), Android (Compose, Hilt, connect-kotlin, Keystore + Tink), Apple (SwiftUI + Observation, GRDB, connect-swift, Nuke, Tuist), Desktop (Rust + Slint in `apps/desktop`: connectrpc, openidconnect, keyring-core, velopack, rusqlite; the Qt 6 / C++23 app was deleted, ADR `apps/desktop/docs/adr/0001-rust-slint-replaces-qt.md`). The per-platform tables and the explicit-rejections list are in the Library-First pages.

## Process rules

- **Versions**: latest stable, verified against the registry. Never invent or guess a version; if you cannot verify it, write `UNVERIFIED`.
- **Approved before first use is machine-enforced** (knip allowlist on Web; `go mod tidy` + golangci-lint `depguard` on Server). Adding to any allowlist requires updating the matching Library-First page in the same change.
- **Single entry point is `task`** (`mise.toml` pins toolchains). `task doctor` shows what this machine can verify; `task verify:<platform>` prints the exact commands; `task check` runs the cheap cross-platform checks.
- **Generated files are never hand-edited.** Design tokens come from `packages/design-tokens` (Style Dictionary); no color literals in hand-written UI code (`task check:colors`).
- **Language: English only** for rule docs, specs, code comments, commit messages and CI; Russian only in `docs/archive/` and locale resources (see CONVENTIONS.md, "Language policy").
- **File size**: keep hand-written files at or under 300 lines; over 500 fails `task check:file-size` (see CONVENTIONS.md).
- **i18n**: strings live with their module; locales en, ru, tg (web calls Tajik `tj`), uz, ar must stay in parity (`task check:i18n`).
- **Honesty about verification**: only Server and Web (the Core profile) are verified. Android, Apple and Desktop are frozen: no new features until each has one green CI run. Android's last JVM run predates the Room 3 migration and it never ran on a device; Apple was never compiled; Desktop passes fmt, clippy, tests and cargo-deny on Windows only. Do not claim they build or work. Status: [docs/content/status.md](docs/content/status.md).
- **Docs are the source of truth**: when you change an architectural decision, update the Library-First page and the decisions page in the same change.

## Forbidden / do not re-propose (summary)

Full list with rationale: [docs/agent/rules.md](docs/agent/rules.md) and the platform decision pages.

- Server: `golang.org/x/image`, Redis (use Valkey), Redlock, Kafka/RabbitMQ, NATS anywhere except `internal/platform/natsbridge` (ADR-0021), a hand-built outbox, a second JWT library, an ORM, chi or any third-party router, self-built identity features.
- Web: RxJS, ESLint/Prettier, a new third-party origin without a CSP update.
- Android: `security-crypto`, Retrofit, Koin, `tv-foundation` lists, a JDK other than 21.
- Apple: XcodeGen, SwiftData, swift-perception, a hand-written image loader, SwiftFormat/Periphery (nicklockwood).
- Desktop (`apps/desktop`): Qt/C++ (deleted), cxx-qt, Tauri/WebView, a hand-written Connect or OIDC client, hand-mirrored DTOs, committed generated code, `unwrap()` and `unsafe`.
- Infrastructure as code: Terraform (use OpenTofu only).
- Kept by owner decision (do not propose replacing): Next.js for `app` and `landing` (`admin` moves to Vite + TanStack Router, planned), React Hook Form, the `cn` package, Goose, Rust + Slint on Desktop (replaced Qt 6 / C++23 on 2026-11-01), Hilt on AGP 9.
