---
title: "Library-First: principles, policy and enforcement"
description: "Part of the Library-First standard. Platform stack tables: Web, Server, Android, Apple, Desktop."
---

# Library-First: principles, policy and enforcement

Part of the [Library-First standard](../library-first.md). Platform stack tables: [Web](web.md), [Server](server.md), [Android](android.md), [Apple](apple.md), [Desktop](desktop.md).

## Core principle

AEDST uses **Library-First Development**. Before writing any new code, an AI agent or engineer must walk the sources of a solution in order instead of starting from "I'll write it myself":

```
STANDARD LIBRARY
      ↓
PLATFORM API
      ↓
EXISTING AEDST DEPENDENCY
      ↓
APPROVED LIBRARY
      ↓
CUSTOM CODE   ← only if nothing above fits
```

**It is forbidden** to implement on your own what an existing library or platform API already provides reliably: HTTP client, form validation, date formatting, drag & drop, JWT, env parser, job queue, WebSocket, protobuf validation, state management, serialization, crypto, UI components. The full list of anti-patterns is below.

> **For AI agents (including Claude in this and future sessions): this is a mandatory architectural rule, not a recommendation.** An implementation that violates Library-First without a documented technical reason is considered non-compliant with the AEDST architecture, even if the code technically works.

> Accepted decisions, their rationale and revisit conditions: [decisions.md](../decisions.md). Rejected proposals: the "Explicit rejections" section below.

## Mandatory workflow

```
TASK → UNDERSTAND REQUIREMENT → CHECK EXISTING CODE
     → CHECK EXISTING AEDST LIBRARIES → CHECK PLATFORM STANDARD API
     → CHECK OFFICIAL / RECOMMENDED LIBRARY → CHECK EXISTING INTERNAL UTILITY
     → REUSE
     → (only if nothing fits) → IMPLEMENT CUSTOM CODE
```

Before creating a utility/helper/hook/component/service/repository/parser/formatter/validator/serializer/cache/queue/retry/HTTP-client/WebSocket-layer/auth-mechanism/crypto/date-time/file-handling/image-processing/drag-and-drop/state-management/animation/testing-utility, you must go through Dependency Discovery: standard library → AEDST stack → installed dependencies → official platform API → recommended ecosystem library → existing implementation in the project.

## Version policy

**Latest stable, verified against the registry. Versions are never invented.**

- Before adding or bumping the version of any dependency (npm, Go module, Maven/Gradle, SwiftPM, Cargo), check the official registry (npm registry, `go list -m -versions`, Maven Central/Google Maven, GitHub releases/tags, crates.io) and take the **latest stable** version. Pre-release/RC/beta only with a documented reason.
- An AI agent **may not** write a version number into a manifest "from memory" or "approximately". If the registry is unavailable, leave the task marked `UNVERIFIED` and say so explicitly instead of substituting a plausible number.
- Toolchain versions are pinned in one place (see "Monorepo tooling" → `mise.toml`; for Desktop, `apps/desktop/qt-version.txt`). Duplicating a version in several files is forbidden.
- Version ceilings are allowed only with a comment and an entry in [decisions.md](../decisions.md). Example: Apple, `swift-protobuf` `>= 1.31.0` as a lower bound. Rule: a package whose newest tag requires a newer `swift-tools-version` than the Xcode used in CI reads is capped by an explicit `allowedVersions` rule in `renovate.json` plus a comment plus an entry in decisions.md; there are currently no such ceilings. Android: JDK 21 as the project toolchain pin; the former reason "detekt 1.23 does not work on JDK 25" was removed by the migration to detekt 2. The only exception to "stable only": Android `dev.detekt:detekt-gradle-plugin` 2.0.0-alpha.6 (owner decision 2026-10-08; 2.x is alpha-only for now; Renovate allows pre-releases only for `dev.detekt`; revisit when 2.0.0 is stable).
- If something could not be verified (for example Apple/Desktop were not compiled in this environment), the document must say so plainly; "looks right" is not verification.

## Approved before first use (machine-enforced)

The policy "a library is approved before its first use" **remains**, but it is now a CI check rather than a convention:

| Platform | Mechanism | Where the allowlist lives |
|---|---|---|
| Web | **knip** (`apps/web/app/knip.jsonc`) fails on unused dependencies/exports | `ignoreDependencies` in `apps/web/app/knip.jsonc` = approved but not yet wired-in libraries |
| Server | `go mod tidy` (diff in CI) + **golangci-lint `depguard`** | allowed/forbidden import list in `apps/server/.golangci.yml`; `architecturetest` |
| Android | Version Catalog allowlist check (`check-catalog-allowlist` in `apps/android/scripts/check-policies.sh`) + detekt `ForbiddenImport` | `libs.versions.toml` is a subset of the Android Library-First page |
| Apple | `apps/apple/scripts/check-dependencies.sh` + SwiftLint `custom_rules` (`sdk_only_in_core`) | `apps/apple/scripts/approved-packages.txt` lists every allowed `.package(url:)` and its single owning Core package (`Tuist/Package.swift` only points at the local `App/Shared` package and is not an allowlist) |
| Desktop | `cargo deny check` (`deny.toml` bans and licences) | `[workspace.dependencies]` in `apps/desktop/Cargo.toml` and the Desktop Library-First page |

Rules:

1. **Adding an entry to an allowlist (knip `ignoreDependencies`, depguard allow-list and `architecturetest/approved_modules.txt`, `apps/apple/scripts/approved-packages.txt`, `vcpkg.json`, `libs.versions.toml`) requires updating this page** (the platform table and, if needed, an entry in [decisions.md](../decisions.md)) in the same PR. An allowlist entry without a docs entry is a violation.
2. An allowlist position is not permanent: if a library is not wired in within one release cycle, it is removed from the allowlist and from the manifest.
3. Test/dev-only packages (Vitest, Testing Library, Playwright, knip, Biome, types, etc.) go only into `devDependencies` (Web) / test scope (other platforms).
4. One primary tool per responsibility (see below): the allowlist is not the place for a second competitor.

## Explicit rejections (do not re-propose)

The project owner **deliberately decided to keep** the following. An AI agent does not propose a replacement, migration or "improvement" without an explicit owner request. The full list with rationale and revisit conditions: [decisions.md](../decisions.md).

| What we keep | What not to propose instead | Reason (short; the owner's request is primary) |
|---|---|---|
| **Next.js** (Web `app` and `marketing`) | Vite / another SPA stack for those two | owner decision; App Router, next-intl and Vercel integrations are already built on it. **Exception, owner decision 2026-11-04: `admin` moves to React + Vite + TanStack Router** (see decisions/web.md); do not extend the exception to `app` or `marketing` |
| **react-use** (not installed) | adding it back for two small hooks | `use-mobile`, `use-online-status` and `use-sentinel` are hand-written documented exceptions (below); revisit if three or more such hooks accumulate |
| **React Hook Form** | TanStack Form, Formik | accepted form standard; integrates with Zod and shadcn/ui |
| **`cn` (npm package)** | a hand-written `clsx + tailwind-merge` helper | dependency of the shadcn ecosystem |
| **Goose** (Server) | Atlas, golang-migrate | Atlas is paid; Goose is proven and fits the modular `goose_<module>` layout well |
| **Rust + Slint** (Desktop) | Qt/C++, Electron, Tauri, Flutter, .NET/WinUI | owner decision (native performance, library-first crates replace about 15,000 hand-written lines); the Qt app was deleted 2026-11-04 |
| **Metro** (Android) | Hilt / Dagger (removed 2026-11-25), Koin, manual DI | compile-time graph validation as a Kotlin compiler plugin, first-class aggregation, no KSP step |
| **webpush-go + `google.golang.org/api/fcm/v1` + apns2** (Server push) | hand-written Web Push (ECE/VAPID), APNs JWT, a hand-written FCM HTTP v1 request/OAuth flow (`x/oauth2/jwt`); also `firebase.google.com/go/v4` (Firebase Admin: pulls Firestore and Storage for one `Send`) | owner decision: libraries instead of custom push code (see decisions.md "Push providers via libraries") |
| **Vercel AI SDK is not used** (Web) | `ai` / `@ai-sdk/*` in Next.js, model calls or API keys in browser/Next code | AI logic lives in Go (one backend for all clients); revisit only if the Go backend serves the AI SDK data-stream protocol (see decisions.md) |
| **Auth.js / next-auth is not used** (Web) | `next-auth`, `@auth/*`, a hand-written OIDC client over `fetch` | npm `latest` is v4; v5 is still `5.0.0-beta.x` (violates the "latest stable" policy), and it also duplicates our session/refresh layer (httpOnly cookie, single-flight, `proxy.ts`). `oauth4webapi` is the very certified zero-dependency layer Auth.js is built on. Revisit when Auth.js v5 is stable **and** supports Next 16 **and** covers our refresh (rotation, single-flight, reuse window) |
| **OpenTofu** (IaC) | Terraform (BSL) alongside OpenTofu, Pulumi, CDK, a second IaC tool | open license, consistent with the stack (DragonflyDB); one state, one lock policy; do not introduce Terraform (BSL) |

## Monorepo tooling

- **mise** (`mise.toml` at the root) pins toolchain versions (Node, pnpm, Go, JDK 21, buf, task, etc.). Change a toolchain version **only there**; do not duplicate it in README/CI without a link to `mise.toml`. Exception: Qt for Desktop is `apps/desktop/qt-version.txt`.
- **Taskfile** is the single entry point. The root `Taskfile.yml` includes each app's Taskfile via `includes`. An agent runs `task <namespace>:<task>` (for example `task lint:migrations` on the server) and does not invent its own commands/scripts when a task already exists. A new routine = a new task in the matching app's Taskfile.
- **Renovate** (`renovate.json` at the root) is the only dependency-update tool in the whole repository (swift, bundler for `apps/apple/Gemfile`, mise, github-actions, Go, pnpm, Gradle, ...). A version ceiling = an explicit `allowedVersions` rule + a comment + an entry in [decisions.md](../decisions.md); for Apple, when the newest tag of a package requires a newer `swift-tools-version` than the Xcode used in CI reads. There are currently no ceilings (other than the swift-protobuf lower bound).
- **Design tokens** have a single source in `packages/design-tokens/` (Style Dictionary). Tokens for Web, Android, Apple and Desktop are **generated** from it. **Generated files must not be edited by hand**: edit the source, then run generation (the design-tokens `task`). Editing a generated file in a PR is a defect. More on the UI kit: [ui-kit.md](../ui-kit.md).

### Documented exceptions (Web)

Confirmed by a technical reason under the rules above:

- `shared/lib/hooks/use-debounced-value.ts`: `debounce` from nuqs only delays the URL write, while the state the request depends on updates immediately; we need a debounce of the value that feeds the request.
- `shared/lib/hooks/use-hydrated.ts`: a form must not be submitted natively before hydration (password in the URL); there is no ready-made solution in the approved stack.
- `shared/lib/hooks/use-mobile.ts`: the shadcn `useIsMobile` breakpoint hook (a `matchMedia` subscription at the Tailwind `md` breakpoint), used by the sidebar primitives; no hooks library is installed (react-use is not a dependency of apps/web).
- `shared/lib/hooks/use-sentinel.ts`: a native `IntersectionObserver` behind a callback ref, the "load the next page" sentinel of infinite and virtual lists; TanStack Virtual does not observe elements outside the list and no hooks library is installed.
- `shared/lib/hooks/use-online-status.ts`: `navigator.onLine` through `useSyncExternalStore` (platform API; Next's `useOffline` is still experimental).
- `shared/lib/consent/*`: consent must be readable by the server (cookie) so the banner lands in the first HTML; project domain logic.
- `app/api/rpc/[...path]/route.ts`: BFF proxy with refresh; a security requirement (tokens are not in JS).
- `shared/lib/forms/protovalidate-resolver.ts`: a thin RHF resolver on top of `@bufbuild/protovalidate`. Form values are not equal to the proto message (date string, trim), whereas the ready-made `standardSchemaResolver` assumes they are; we need a form → message mapping and violation → field mapping.
- Web Push: `notifications/lib/web-push.ts` and `use-push-key-rotation.ts` implement the VAPID key rotation from [server/push.md](../server/push.md) (unsubscribe and resubscribe when `applicationServerKey` changes).

## One responsibility → one primary tool

For one responsibility, one primary tool, unless there is an explicit architectural reason to have several. Not `Moment + date-fns + Day.js + Luxon` at once; only `date-fns`. The same rule applies to Backend, Android, Apple and Desktop.

## Custom code exception

Custom code is allowed only after going through the whole chain (Standard Library → AEDST Library → Platform API → Approved Library → Existing Internal Implementation) and only with a technical reason:

**Good reasons:** the functionality is unavailable; the library does not support the platform; an incompatible API; unacceptable performance characteristics; a security/compliance requirement; project domain logic; the dependency would add significantly more complexity than the implementation itself; the library is abandoned/incompatible.

**Bad reasons:** "it is simpler to write it myself", "it is only 50 lines", "I can do it better", "I don't like the API", "it is faster to write".

## Existing code first

Before creating a new component/service/utility, look for: an existing implementation → an existing abstraction → an existing module → an existing dependency → an existing API → an existing pattern → an existing test.

- Fits → **REUSE**
- Almost fits → **EXTEND**
- Architecturally wrong → **REFACTOR**
- None of the above is possible → **CREATE**

## Dependency addition rule

If the existing stack does not solve the task and a new dependency is needed: search the ecosystem → check the official library → maintenance status → license → security history → compatibility → bundle/build impact → transitive dependencies → could an existing dependency solve it → add only when justified. Do not add a library just because it is popular.

## Anti-patterns (examples)

```text
❌ Do not write your own HTTP client        → use the existing API client
❌ Do not write your own form validation    → React Hook Form + Zod
❌ Do not write your own date formatter     → date-fns
❌ Do not write your own drag & drop        → dnd-kit
❌ Do not write your own JWT                → jwx
❌ Do not write your own push (ECE/VAPID/APNs JWT/FCM OAuth) → webpush-go, `google.golang.org/api/fcm/v1`, apns2
❌ Do not write your own env parser         → caarlos0/env
❌ Do not write your own job queue          → River
❌ Do not write your own WebSocket          → coder/websocket
❌ Do not write your own distributed lock   → Postgres advisory locks (internal/platform/lock)
❌ Do not publish events from a handler     → events.Publisher.Publish inside the transaction (River InsertTx)
❌ Do not write your own identity functions → OIDC IdP (ZITADEL by default)
❌ Do not edit generated design tokens      → packages/design-tokens (the source)
❌ Do not write a dependency version from memory → check the registry (Version policy)
❌ Do not write your own protobuf validation → Protovalidate
❌ Do not write your own JSON/protobuf serializer → the standard/official serializer
❌ Do not write your own crypto             → proven cryptographic libraries
❌ Do not write your own UI component       → first check shadcn/ui / core/ui / AedstDesignSystem
```

The AI must detect on its own: custom code that duplicates an existing library; duplicated utilities/dependencies/API clients/validation/state management/networking/caching/retry logic/serialization/date handling/UI primitives/auth logic. When found: **STOP → REVIEW → REUSE/CONSOLIDATE → TEST**.

## Enforcement

Documentation is not enough; the rules are checked automatically wherever possible:

| Platform | Tool |
|---|---|
| Web | Biome (the only linter/formatter), TypeScript, knip (`apps/web/app/knip.jsonc`), `apps/web/app/scripts/check-feature-boundaries.sh` |
| Server | golangci-lint (`depguard`), `go vet`, `go mod tidy` diff, `architecturetest`, `sqlc vet`, squawk (`task lint:migrations`) |
| Android | Detekt 2.x (JDK 21), ktlint |
| Apple | swift-format (`make format-check`) + SwiftLint 0.65.1 (semantic rules), `apps/web/app/scripts/check-feature-boundaries.sh` (first run at the first Xcode build) |
| Desktop | clang-format, clang-tidy, `check-proto-freshness.sh`, `check-protovalidate-pin.sh`, `contract/methods.hpp` drift test |
| All | dependency scanners, CI, `scripts/check-naming.sh` |

Naming of files/components/dependencies: see [CONVENTIONS.md](../../../CONVENTIONS.md). The list of accepted and rejected decisions: [decisions.md](../decisions.md).

## Definition of Done for AI

```text
[ ] Existing implementation checked
[ ] Existing dependencies checked
[ ] Platform API checked
[ ] No unnecessary custom implementation
[ ] No duplicate dependency
[ ] Architecture rules respected
[ ] Naming conventions respected (CONVENTIONS.md)
[ ] Tests added/updated
[ ] Linter passes
[ ] Formatter passes
[ ] Type checking passes
[ ] Build passes
[ ] Existing tests pass
[ ] Security checks pass where applicable
[ ] Documentation updated where architecture changed
[ ] New dependency: allowlist (knip / depguard / manifest) + table in library-first.md updated
[ ] Versions verified against the registry, not invented; unverified marked UNVERIFIED
[ ] No replacement from "Explicit rejections" proposed
```

## Philosophy

```
Reuse > Rewrite
Existing abstraction > New abstraction
Platform API > Custom implementation
Established library > Handwritten utility
One standard tool > Multiple overlapping tools
Simple architecture > Clever architecture
Explicit dependency > Hidden dependency
Tested implementation > Fast implementation
Production solution > Prototype solution
```

**Final rule:** do not write code that an existing library or platform already knows how to do. First find and use the existing solution. Only after reuse is proven impossible may you create your own implementation.
