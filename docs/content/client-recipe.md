---
title: Client recipe
description: The eight-step recipe for adding a feature to all four clients (web, Android, Apple, Desktop), with the file each step produces on each platform.
---

# Client recipe: one feature, eight steps, four clients

Every client carries the same mental model: **declare, domain, data, presentation, navigation, i18n, wire, test**.
The names differ only by language idiom. A developer who knows the Tasks module on one platform can find the
same file on the other three. The reference feature is `tasks`; its behaviour spec is
[features/tasks](/features/tasks). Parity is machine-checked by `task check:features` (shape) and
`task check:behavior` (shared scenarios), see [parity](/parity).

Platform status: see [status](/status). Web is verified; Android, Apple and Desktop are frozen (no green CI run yet). The Apple row
describes the intended, statically reviewed shape (never compiled); the Desktop row is the real `aedst-feature-tasks` layout.

## The eight steps

| # | Step | Web (`apps/web/app/src/modules/<f>`) | Android (`apps/android/feature/<f>`) | Apple (`apps/apple/Features/<F>`) | Desktop (`apps/desktop/crates/aedst-feature-<f>`) |
|---|---|---|---|---|---|
| 1 | **Declare** in `features.yaml` | same row for all five platforms: `id`, `flagged`, `outbox` types, `i18n_namespace`, `routes` | | | |
| 2 | **Domain** | `lib/*.ts` (types from the generated client, pure helpers) | `domain/src/commonMain/.../domain/<Entity>.kt`, `<Entity>Repository.kt`, `<Verb><Entity>UseCase.kt` (the Kotlin Multiplatform module `feature/<f>/domain`: common code, no Android or DI types, [KMP structure](/android/kmp)) | `Sources/<F>Domain/<Entity>.swift`, `<Entity>Repository.swift`, `<Verb><Entity>UseCase.swift` | `src/domain/<entity>.rs`, `ports.rs` (repository trait), `service.rs` (use cases), `validation.rs` |
| 3 | **Data** | `lib/<f>-writes.ts`, `lib/use-<f>-writes.ts`, `outbox.ts` + `lib/outbox-handlers.ts` | `data/Connect<Entity>Repository.kt` (the only file with proto types), `<Entity>OutboxHandlers.kt` | `Sources/<F>Data/Connect<Entity>Repository.swift`, `<Entity>OutboxHandlers.swift` | `src/data/connect_repository.rs` (the only file with `aedst-contract` types), `mapping.rs`, `outbox.rs` |
| 4 | **Presentation** | `ui/<Screen>.tsx` (hooks are the view model) | `presentation/<screen>/<Screen>ViewModel.kt` + `<Screen>Screen.kt` | `Sources/<F>Presentation/<Screen>ViewModel.swift` (shared) + `<Screen>View.swift` twice: `Sources/<F>UIiOS/` and `Sources/<F>UIMac/` | `src/presentation/controller.rs` + `<screen>_state.rs`; view `ui/<f>.slint`, bound in `src/ui_glue.rs` |
| 5 | **Navigation** | `manifest.ts` (routes, access, nav entry); pages in `src/app/(pages)/[locale]/(app)/<f>` | `navigation/<F>NavGraph.kt` + typed key in `core/navigation` | `<F>Destinations.swift` in `Sources/<F>UIiOS/` and `Sources/<F>UIMac/`; route enum in `Core/AedstNavigation/AedstRoutes.swift` | route name and constructor in `aedst-navigation/src/route.rs` (`names::*`, `routes::*`); `nav_graph()` in `aedst-desktop/src/services.rs` |
| 6 | **i18n**, five locales | `i18n/{en,ru,tj,uz,ar}.json` | `src/main/res/values{,-ar,-ru,-tg,-uz}/strings.xml` (`values/` is English) | `Resources/Localizable.xcstrings` | `i18n/{en,ru,tg,uz,ar}/LC_MESSAGES/aedst-feature-<f>.po` |
| 7 | **Wire** (composition root) | one line in `src/app/config/modules/registry.ts` + catalogue type | `<F>Providers.kt` (a public `@BindingContainer @ContributesTo(AppScope::class)` interface) merged into the app graph; it `@Provides` the use cases (common code has no `@Inject`); the classes bind themselves with `@ContributesBinding` / `@ContributesIntoSet` / `@ContributesIntoMap` | registration in `AppDependencies` | construct the feature in `aedst-desktop/src/services.rs` and add its id to `client_build()` features; the id equals the feature id |
| 8 | **Test** | `ui/<Screen>.test.tsx`, `lib/*.test.ts`, replay test in `src/test/contract` | `<Screen>ViewModelTest`, `Connect<Entity>RepositoryTest`, `<Behavior>ReplayTest` | `<Screen>ViewModelTests`, `<Behavior>ReplayTests` | `tests/<screen>_controller.rs`, `tests/service.rs`, `tests/layers.rs`, `tests/catalogs.rs`, replay test of the behavior fixture |

Notes per step:

1. **Declare first.** `scripts/check-features.mjs` (shape rules in `scripts/features/shape.mjs`) fails when a platform
   declares a different `flagged` set, a different outbox type list than `offline-outbox.json` knownTypes, or lacks a
   layer. Deviations are written under `exceptions:` with a reason; a stale exception also fails.
2. **A use case exists only when there is client logic** (validation, composition, idempotency key). Otherwise
   ViewModel → Repository. `CreateTaskUseCase` exists on Android, Apple and Desktop (title 1–200, description ≤ 4000,
   counted in code points); on web the same limits come from the proto through `protovalidateResolver`.
3. **One data file touches proto types.** Everything above it works with domain types, so a proto change has one
   blast radius per platform. The repository name is `<Transport><Name>Repository`
   (`ConnectTaskRepository`; Android sign-in is `OidcAuthRepository` because its transport is OIDC).
   The outbox method is `deliver` on every platform.
5. **Typed routes, no strings at call sites.** Apple keeps all route enums in `AedstRoutes.swift` so
   `Features/Tasks` can push `MediaRoute.detail` the way Android pushes `MediaDetailKey`, while each feature keeps its
   own `*Destinations` modifier. Desktop screens are Slint files registered in `aedst-desktop`.
7. **Desktop feature crate name == `aedst-feature-<id>`** (see `features.yaml`).

## Web `ui` / `lib` ↔ Domain / Data / Presentation

Web keeps its documented folder names (`ui/`, `lib/`; see [shared README](/web/architecture)). The mapping:

| Web | Native layer | What lives there |
|---|---|---|
| `ui/` | Presentation | Components, forms, stories, component tests |
| `lib/` pure files (`labels.ts`, `list-tasks-input.ts`, `task-search-params.ts`) | Domain | Types, query shape, URL-state parsers, formatting |
| `lib/` I/O files (`task-writes.ts`, `use-task-writes.ts`, `outbox-handlers.ts`) | Data | Generated-client calls, mutations, outbox handlers |
| `manifest.ts`, `public.ts` | Navigation | Routes, access, nav entry, what other modules may import |
| `src/test/contract/*.replay.test.ts` | tests | Replay of `docs/contract/behavior/*.json` |

## Rules that hold on every platform

- **Unknown enum values are never defaulted to a real state.** A status or priority this build does not know
  (`UNSPECIFIED`, or a value added by a newer server) becomes `.unknown` / `UNKNOWN`, rendered as a neutral badge,
  never offered when creating, and mapped back to `UNSPECIFIED` on write so the server rejects it. Switches over
  these enums are exhaustive (no `default:`), so a new case breaks the build instead of silently becoming `todo`.
- **Same list query.** `list(TaskQuery)` with page size **20** and the default sort (created, descending).
  Search is trimmed and capped at 200 characters. The cursor is an opaque `pageToken`.
- **One error vocabulary.** Thirteen kinds (`unauthenticated … unknown`) with the same `retryable` and `reportable`
  flags, from `docs/contract/behavior/error-kinds.json`. `cancelled` shows no alert.
  Only `unknown` and `storage` go to the crash reporter.
- **Analytics names come from `docs/contract/analytics-events.json`** (`task_created`, `task_completed`, …), checked
  by `task check:analytics`. Properties are product facts, never PII.
- **Offline writes** go through the outbox with an idempotency key (the outbox item id), per
  `offline-outbox.json`. Android currently registers no task handler (declared GAP in `features.yaml`).
- **Capabilities**: a `flagged` feature shows only when the server enables it. Today only `admin` is flagged, on
  every client (see [cross-cutting decisions](/decisions/cross-cutting)).
- **Strings** live with their module, never in shared code; all five locales or `task check:i18n` fails.
  Web calls Tajik `tj`; the other platforms use `tg` (`toLanguageTag` maps it for `Intl`).

## Desktop sign-in placement (exception)

Desktop keeps OIDC in the `aedst-oidc` crate (built on `openidconnect`), not in a feature crate as Android and Apple do. One session
is the token provider for every feature and is restored and ended by `aedst-desktop`. Reason and "revisit when": [decisions/desktop](/decisions/desktop).

## Adding a feature: checklist

1. Add the `features.yaml` row; run `task check:features` and expect it to say what is missing.
2. `task new:module -- NAME=<id>` scaffolds the web side and registries (see `docs/agent/new-module.md`).
3. Implement steps 2–8 on web first (the parity source), then Android, then Apple and Desktop.
4. Add or extend a scenario in `docs/contract/behavior/` if the feature has shared rules; replay it on each client.
5. Run `task check`, then the platform's `task verify:<platform>` commands. Claim only what ran.
