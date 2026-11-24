---
title: "One structure everywhere: module, then feature"
description: "The same two-level layout on Server, Web, Android, Apple and Desktop: a few large modules, features inside each, modules that talk only through contracts."
---

# One structure everywhere: module, then feature

Owner decision, 2026-11-21 ([decisions/cross-cutting](/decisions/cross-cutting)). Every platform uses the
same shape, so a person or an agent who knows one app can find the same thing in the other four.

- **Module**: a large business area with its own data and its own contract, for example `wallet`,
  `messenger`, `tasks`. A module is the unit that can be extracted (a service on the server, a package
  on a client). The module id is the same string on every platform and in `features.yaml`.
- **Feature**: one user-visible capability inside a module, for example `wallet/transfer`,
  `wallet/history`, `messenger/chat`, `messenger/attachments`. A feature is a vertical slice and is the
  unit of work for one task.

Identity is not a module of this template: sign-in belongs to the identity provider
([ADR-0019](/decisions/server)); the `auth` client module is only the OIDC session.

## Rules (the same on every platform)

1. A module never imports another module's internals. It uses that module's **public contract** only:
   the Protobuf API and events on the server, the `public.ts` / `api` package / public Swift product /
   crate root on the clients.
2. A feature never imports another feature. Two features share code by moving it to the module's own
   `shared` (or `domain`) folder, which features may import and which imports no feature.
3. Dependencies point one way: `feature -> module shared -> core/platform`. Nothing in `core` or
   `platform` knows a module.
4. A module owns its strings (five locales), its tests, its storage (schema, tables, catalogues) and its
   documentation page under `docs/content/modules/<module>/`.
5. A module with one capability does not need a `features/` folder. Add the level when the second
   capability arrives, in the same change, never by leaving two capabilities mixed in one folder.

## Layout per platform

| Platform | Module | Feature inside the module | Shared inside the module | Public contract |
|---|---|---|---|---|
| Server | `apps/server/internal/modules/<module>/` | `features/<feature>/{application,domain,infrastructure,transport}` | `api/`, `domain/`, `module/` (registration; the only package that imports features), shared `infrastructure/<pkg>` and `transport/<pkg>` | `api/proto/aedst/<module>/v1`, `<module>/api` (Go), events |
| Web | `apps/web/<project>/src/modules/<module>/` | `features/<feature>/{ui,lib}` | `lib/`, `ui/`, `i18n/`, `entries/` | `manifest.ts`, `public.ts` |
| Android | `apps/android/feature/<module>/` | `<feature>/{data,presentation}` packages in the Android module and the pure domain in the Kotlin Multiplatform module `feature/<module>/domain` (`commonMain`; `domain` is a reserved directory name, see [KMP structure](/android/kmp)), or `feature/<module>/<feature>` Gradle modules once a module has three or more | `feature/<module>/shared` | the module's `api` package and navigation keys |
| Apple | `apps/apple/Features/<Module>/` | not split into features yet: one SwiftPM target per layer, `Sources/<Module>{Domain,Data,Presentation,UIiOS,UIMac}` (shared logic, one UI target per platform, see [decisions/apple](/decisions/apple)) | the `<Module>Domain` and `<Module>Presentation` targets | the package's public products (`<Module>Domain`, `<Module>Data`, `<Module>Presentation`, and one of `<Module>UIiOS` / `<Module>UIMac` per app) |
| Desktop | `apps/desktop/crates/aedst-feature-<module>/` | `src/<feature>/{domain,data,presentation}` Rust modules and `ui/<feature>/` Slint files ([desktop/boundaries](/desktop/boundaries)) | `src/shared/`, `ui/shared/` | the crate root (`lib.rs`) |

## How a module behaves like a service (server)

The server is one deployable by default and a set of services by configuration, without code changes
([ADR-0020, ADR-0022](/decisions/server)):

- one schema, one migration table and one sqlc package per module, no cross-schema SQL or foreign keys;
- calls between modules go through the generated Connect client of the callee's API, in process by
  default and over the network when `AEDST_MODULE_<NAME>_URL` is set;
- events are written in the producer's transaction (River) and forwarded between databases;
- `AEDST_MODULES` selects which modules a process hosts.

The unit of extraction is the module, not the feature: a server feature has no contract, schema or
registration of its own. Proof that needs no database: `internal/modules/tasks/module/extraction_test.go`
(two processes resolved from `AEDST_MODULES` / `AEDST_MODULE_TASKS_URL`, a call that crosses HTTP through the
generated Connect client); the same with two real servers on Postgres is the `integration`-tagged
`cmd/server/extraction_integration_test.go` (compiled here, not run: no Docker on the authoring machine).

## Status (honest)

| Platform | Module level | Feature level | Gate |
|---|---|---|---|
| Server | Implemented and enforced (depguard, `architecturetest`) | Implemented in the reference module `internal/modules/tasks`: `features/core` (create, read, list, edit, delete, counts), `features/completion` (complete, reopen and the `TaskCompleted` event), `features/reminders` (the River due-soon job, its scheduler and the guarded `TaskDueSoon` write; no transport, it serves no RPC) and `features/operator` (cross-owner list, counts and delete behind `TasksOperatorService`). Module-level by design: `api/` (contract and events), `domain/` (the `Task` entity and the listing vocabulary two features use), `infrastructure/store` (row mapping and the one event writer), `transport/taskproto` (proto mapping, identity check) and `module/` (registration, the composed `api.Service` and `TasksService` handler, the `Remote` hook). Stayed module-level because splitting would change the contract or the data: one proto service `TasksService` and one `api.Service` span `core` and `completion` (composed in `module/compose.go`, not split); one schema, one `sql/tasks/queries.sql` and one sqlc package serve all four features; the Postgres integration tests exercise several features in one transaction story, so they live in `module/`. The seven other modules have one capability each and stay flat (rule 5). `task new:module` scaffolds a module with one feature (`features/entries`); `task new:feature -- MODULE=<m> NAME=<f>` adds one | `architecturetest/features_test.go` and `features_composition_test.go`: `TestFeaturesMeetOnlyThroughTheirModule` (no feature to feature, no shared package to a feature, nothing outside the module to a feature), `TestLayersOnlyImportInward` (layer rules inside a feature and from a feature to the module's shared packages), `TestEveryFeatureHoldsOnlyTheKnownLayers`, `TestEveryFeatureIsComposedByItsModule`, each with a negative self-test; depguard `feature-domain-is-pure` (the import ban is not mirrored in depguard, like the module pairs) |
| Web | Implemented in all three projects: every module of `app`, `admin` and `marketing` has `manifest.ts` and `public.ts` and is listed in its project's registry | Implemented in the reference module `app/src/modules/tasks` (`features/{list,details,create,dashboard}/{ui,lib}`; the form, badges and writes two features share stay in the module's `ui/` and `lib/`). The other modules have one capability each and stay flat (rule 5); `media` keeps its layered folders because they are parts of one capability (task attachments), not features. `task new:module` scaffolds one feature; the web feature scaffold is `scripts/new-feature-web.mjs` (`MODULE`, `NAME`) | `check-feature-boundaries.sh` (authoritative, rules 6-9: no feature to feature, no module shared code to a feature, feature folder shape, no project to project) for `app`, `admin` and `marketing`, in `task check:boundaries` and the three CI workflows, with negative fixtures in `pnpm check:selftest`; dependency-cruiser repeats the graph rules in each project (supplementary: it cannot load TypeScript 7.0) |
| Android | Implemented (`feature/<module>`), frozen | Not implemented | `check-feature-boundaries.sh` (grep; also: only a module depends on its own `domain` module, and domain modules are common code with no Android or JVM-only import) |
| Apple | Implemented (`Features/<Module>` packages, five targets each), frozen, never compiled | Not implemented | `check-feature-boundaries.sh`, `check-feature-layers.sh`, SwiftPM |
| Desktop | Implemented (`aedst-feature-*` crates), frozen | Rule and gate only: the layout (`src/<feature>/`, `ui/<feature>/`, `shared`) is defined in [desktop/boundaries](/desktop/boundaries) and checked, but all five crates are still flat and none was split (no compiler on the authoring machine; `notifications`, `admin` and `media` are the candidates) | `apps/desktop/scripts/check-feature-boundaries.sh` (bash + node, no cargo; rules D1-D6: no feature to feature, features use the allowed core crates only, only `aedst-desktop` composes features, no `std-widgets` in a feature, flat-or-split layout) with a negative self-test, in `task check:boundaries`, `policies-ci.yml` and `desktop-ci.yml`; per-crate `tests/layers.rs` for the layers (needs cargo) |

Work order: Server and Web first (reference feature split of `tasks`, generator support
`task new:feature`, gates for all three web projects), then each frozen platform after its first green
CI run ([status](/status)). Do not create the feature level on a frozen platform before that.
