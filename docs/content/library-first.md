---
title: "AEDST — Library-First Development Standard"
description: "Custom code needs a documented technical reason (missing functionality, unsupported platform, incompatible API, unacceptable performance,..."
---

# AEDST — Library-First Development Standard

**Do not write code that an existing library or platform already does.** Before creating any utility, hook, component, service, repository, parser, formatter, validator, serializer, cache, queue, retry, HTTP client, WebSocket layer, auth mechanism, crypto, date/time, file handling, image processing, drag and drop, state management, animation or test utility, walk the sources in this order and stop at the first that fits:

```
STANDARD LIBRARY -> PLATFORM API -> EXISTING AEDST DEPENDENCY -> APPROVED LIBRARY -> CUSTOM CODE
```

Custom code needs a documented technical reason (missing functionality, unsupported platform, incompatible API, unacceptable performance, security/compliance requirement, project-specific domain logic), never "it is simpler to write it myself". This is a mandatory architectural rule for AI agents and engineers alike.

Read only the page you need. Decided items and their revisit conditions are in the [decisions index](decisions.md).

| Page | What is in it |
|---|---|
| [General rules](library-first/general.md) | Principle and workflow, version policy (latest stable, verified against the registry, never invented; mark `UNVERIFIED`), "approved before first use" and its machine enforcement, explicit rejections (do not re-propose), monorepo tooling, documented exceptions, one responsibility = one primary tool, custom code exception, existing code first, dependency addition rule, anti-patterns, enforcement, AI Definition of Done, philosophy |
| [Web stack](library-first/web.md) | Responsibility to tool table: validation, dates, drag and drop, UI, animations, URL state, server state, OIDC sign-in, tables, virtualization, testing, performance budgets, lint, API, error tracking, analytics, client state, PWA, web push, media, i18n, charts, theming |
| [Server stack](library-first/server.md) | Responsibility to tool table: IaC, API contract and generation, RPC, validation, database/driver/SQL/migrations, jobs, events, cache, locks, rate limiting, JWT, identity, configuration, observability, health, retention, integration testing, object storage, push, device attestation, media, HTTP hardening, static analysis, load testing |
| [Android stack](library-first/android.md) | Responsibility to tool table: DI, local DB, settings, images, secrets, offline queue, network state, navigation, OIDC and TV sign-in, JVM/screenshot/accessibility/contract tests, performance, release build, attestation, crash reporting, analytics, push, media, static analysis |
| [Apple stack](library-first/apple.md) | Responsibility to tool table: API client, persistence, Observation, navigation, DI, OIDC sign-in, secrets, attestation, crash reporting, analytics, push, media, tests, format/lint, signing and release, dependency updates |
| [Gateway stack](library-first/gateway.md) | Rust realtime gateway (`apps/gateway`): runtime, WebSocket (axum), NATS JetStream client, token verification, observability, tests, rejections |
| [Desktop stack](library-first/desktop.md) | Responsibility to tool table: API contract, validation, local DB, OIDC sign-in, TLS, secrets, network/i18n, platform services, updates, crashes, analytics, media, transport policy, tests/analysis/release |

## Rules every change must respect

1. Check, in order: the standard library, the platform API, the dependencies already in `package.json` / `go.mod` / `build.gradle.kts` / `Package.swift` / `vcpkg.json`, then existing code in this repo.
2. Versions: latest stable verified against the registry; never guess one.
3. An allowlist entry (knip `ignoreDependencies`, depguard, `Tuist/Package.swift`, `Cargo.toml`/`deny.toml`, `libs.versions.toml`) requires updating the matching platform page in the same change.
4. Design tokens come from `packages/design-tokens`; generated token files are never hand-edited.
5. Anything listed under "Explicit rejections" in [General rules](library-first/general.md#explicit-rejections-do-not-re-propose) is not re-proposed.
