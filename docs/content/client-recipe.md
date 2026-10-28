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

Platform status: web and Android are verified (Android on the JVM only); Apple and Desktop were never compiled,
so their rows describe the intended and statically reviewed shape.

## The eight steps

| # | Step | Web (`apps/web/app/src/modules/<f>`) | Android (`apps/android/feature/<f>`) | Apple (`apps/apple/Features/<F>`) | Desktop (`apps/desktop/Modules/Features/<F>`) |
|---|---|---|---|---|---|
| 1 | **Declare** in `features.yaml` | same row for all five platforms: `id`, `flagged`, `outbox` types, `i18n_namespace`, `routes` | | | |
| 2 | **Domain** | `lib/*.ts` (types from the generated client, pure helpers) | `domain/<Entity>.kt`, `<Entity>Repository.kt`, `<Verb><Entity>UseCase.kt` | `Domain/<Entity>.swift`, `<Entity>Repository.swift`, `<Verb><Entity>UseCase.swift` | `Domain/<entity>.hpp`, `<entity>_repository.hpp`, `<verb>_<entity>_use_case.{hpp,cpp}` |
| 3 | **Data** | `lib/<f>-writes.ts`, `lib/use-<f>-writes.ts`, `outbox.ts` + `lib/outbox-handlers.ts` | `data/Connect<Entity>Repository.kt` (the only file with proto types), `<Entity>OutboxHandlers.kt` | `Data/Connect<Entity>Repository.swift`, `<Entity>OutboxHandlers.swift` | `Data/connect_<entity>_repository.{hpp,cpp}`, `<entity>_outbox_handlers.{hpp,cpp}` |
| 4 | **Presentation** | `ui/<Screen>.tsx` (hooks are the view model) | `presentation/<screen>/<Screen>ViewModel.kt` + `<Screen>Screen.kt` | `Presentation/<Screen>ViewModel.swift` + `<Screen>View.swift` | `Presentation/<screen>_view_model.{hpp,cpp}` + `<Screen>View.qml` |
| 5 | **Navigation** | `manifest.ts` (routes, access, nav entry); pages in `src/app/(pages)/[locale]/(app)/<f>` | `navigation/<F>NavGraph.kt` + typed key in `core/navigation` | `Navigation/<F>Destinations.swift`; route enum in `Core/AedstNavigation/AedstRoutes.swift` | `Navigation/<f>_destinations.{hpp,cpp}`; typed helper next to `routes::k*` in `Core/Navigation` |
| 6 | **i18n**, five locales | `i18n/{en,ru,tj,uz,ar}.json` | `src/main/res/values{,-ar,-en,-tg,-uz}/strings.xml` | `Resources/Localizable.xcstrings` | `i18n/<f>_{en,ru,tg,uz,ar}.ts` |
| 7 | **Wire** (composition root) | one line in `src/app/config/modules/registry.ts` + catalogue type | `<F>Module.kt` (Hilt) included by the app | registration in `AppDependencies` | `plugin_manager` registration; plugin id equals the feature id |
| 8 | **Test** | `ui/<Screen>.test.tsx`, `lib/*.test.ts`, replay test in `src/test/contract` | `<Screen>ViewModelTest`, `Connect<Entity>RepositoryTest`, `<Behavior>ReplayTest` | `<Screen>ViewModelTests`, `<Behavior>ReplayTests` | `tests/<verb>_<entity>_use_case_test.cpp`, `*_replay_test.cpp` |

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
   own `*Destinations` modifier. On Desktop plugins report `linkPrefixes` in `RouteContribution`; both deep-link
   allow-lists are derived from the active routes.
7. **Plugin id == feature id** on Desktop (`tasks`, not `aedst.tasks`).

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

Desktop keeps OIDC in `Modules/Core/Oidc`, not under `Features/Auth/Data` as Android and Apple do. One `OidcSession`
is the `TokenProvider` for every feature and is restored and ended by `App/`, and the GPL/commercial QtNetworkAuth
dependency is confined to one target. Reason and "revisit when": [decisions/desktop](/decisions/desktop).

## Adding a feature: checklist

1. Add the `features.yaml` row; run `task check:features` and expect it to say what is missing.
2. `task new:module -- NAME=<id>` scaffolds the web side and registries (see `docs/agent/new-module.md`).
3. Implement steps 2–8 on web first (the parity source), then Android, then Apple and Desktop.
4. Add or extend a scenario in `docs/contract/behavior/` if the feature has shared rules; replay it on each client.
5. Run `task check`, then the platform's `task verify:<platform>` commands. Claim only what ran.
