---
title: "Decisions index"
description: "Index of the architectural decisions that shape the stack: what was decided, why, and when it is legitimate to revisit. AI agents: if a proposal contradicts..."
---

# Decisions index

Index of the architectural decisions that shape the stack: what was decided, why, and **when it is legitimate to revisit**. AI agents: if a proposal contradicts a decision listed in a topic page, do not implement it and do not re-propose it; if you believe a "revisit when" trigger has fired, say so to the owner and cite the row. Read only the page for the platform you touch.

Status legend: **Accepted** (in force), **Kept** (owner explicitly decided to keep the status quo; see [Explicit rejections](/library-first/general#explicit-rejections-do-not-re-propose)), **Pending** (known follow-up, not done).

Verification legend: entries about Apple were **statically reviewed only** (no Xcode in the authoring environment) and Desktop entries are verified on Windows only; the first real build is their acceptance test. Items marked `UNVERIFIED` were reported by the platform work but not independently checked by the documentation pass.

Each topic page is a table with columns Decision, Status, Rationale, Revisit when.

| Page | Rows | Covers |
|---|---|---|
| [Cross-cutting](/decisions/cross-cutting) | 15 | Version policy, machine-enforced allowlists, mise/Taskfile/design tokens, modular monolith + ConnectRPC + PostgreSQL, empty-template scope, telemetry split (Sentry vs PostHog), push channels, `update-deps`, the shared `flagged` set, the shared error vocabulary, the feature shape contract, the engineering standard |
| [Server](/decisions/server) | 40 | Valkey, advisory locks, River as outbox (events), ServeMux, Goose/squawk, OIDC resource server (ZITADEL), OpenTelemetry, Protovalidate, idempotency, retention, roles, HA Postgres, OpenTofu + GitOps, media (govips + imgproxy), wiring split and layer tests, image CI job, go-redis kept, object storage, push providers, device attestation, k6 |
| [Web](/decisions/web) | 39 | Next.js, Biome, knip, httpOnly session + OIDC (`oauth4webapi`), CSP (proxy.ts only), GraphQL removed, Storybook 10, file-size and colour gates, URL state, analytics opt-in, i18n tags, perf budgets, Vitest/Playwright, Zod, TanStack, Zustand, PWA (Serwist), errors, contract test, release-age security fast path |
| [Android](/decisions/android) | 28 | JUnit 6 model, adaptive layouts, Keystore + Tink (no EncryptedSharedPreferences), Hilt on AGP 9, connect-kotlin, JDK 21, Room outbox + WorkManager, Sentry, Media3/Coil, Navigation 3, AppAuth + device grant for TV, R8, Roborazzi, Play Integrity |
| [Apple](/decisions/apple) | 27 | Tuist, GRDB, SQLiteData, OS floors, connect-swift (grpc-swift-2 migration attempted and reverted 2026-10-29), Swift 6 strict concurrency, release tooling evaluation, Keychain session, `ASWebAuthenticationSession` with ID-token signature verification, fastlane + match, Nuke, Swift Testing, swift-format, App Attest (statically reviewed only) |
| [Desktop](/decisions/desktop) | 36 (+ 6 proposals awaiting the owner) | Rust + Slint replaces Qt 6 / C++23 (Qt deleted 2026-11-04), connectrpc, openidconnect, keyring-core, rusqlite with a hand-written frozen migrator, i18n via gettext, self-update (Velopack, signed manifest), consent-gated Sentry, analytics through the server (follow-up), UI tests with `i-slint-backend-testing` (Windows only) |

Architecture Decision Records 0001-0016 are listed in the sidebar under this section; server ADRs 0017-0019 live in `apps/server/docs/adr/` (indexed in its README). Platform ADRs: `apps/server/docs/adr/`, `apps/desktop/docs/adr/`.

When you change a decision, update the matching topic page here and the Library-First page in the same change ([Library-First index](/library-first)).
