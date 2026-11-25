---
name: new-module
description: Add a new feature module (vertical slice) to AEDST with `task new:module`, then finish what the generator deliberately leaves out, per platform. Use when asked to add a module, feature area or bounded context; not for adding a screen to an existing module.
argument-hint: "<name> [--platforms=server,web,...]"
---

# new-module

The generator stamps a minimal slice and registers it. This skill is the checklist for what comes before and after, because the expensive mistakes are the registrations and the platform-specific leftovers. Full reference: [`docs/agent/new-module.md`](../../../docs/agent/new-module.md).

## 0. Before stamping

1. **Spec first.** Run the `write-spec` skill; do not stamp until the spec is approved. The spec decides the aggregate, the RPCs and the events.
2. **Name**: one lowercase word, 2 to 24 letters or digits, not reserved, not already used on any platform. The generator refuses otherwise.
3. **Profile**: read `docs/content/status.md`. Check which platforms this product keeps (`apps/*` that exist). Pass `--platforms=` for those only. With a partial set `features.yaml` is not edited and `task check:features` stays red until you declare the module by hand.
4. **Cross-module needs**: if the new module must call another module, plan to do it through that module's `api/` package or an event. Decide now which.

## 1. Stamp

```bash
task new:module -- NAME=<id> --dry-run     # read the plan first
task new:module -- NAME=<id>               # then stamp (runs buf generate and sqlc generate)
```

Undo a stamp git does not track yet: `--remove` (refuses when files changed; `--force` overrides, ask first).

## 2. Finish, per platform

Replace the placeholder entry with the real aggregate, then:

| Platform | Must do next | Gate |
|---|---|---|
| Server | Write migration `migrations/<id>/` (check `scripts/lint-migrations.sh` rules), real sqlc queries, domain rules, `application` service tests; add the event publisher and idempotency only if the spec says so (copy `tasks`). New direct dependency goes through `add-dependency`. | `task server:check`, `task server:test:integration` (Docker or `AEDST_TEST_DATABASE_URL`) |
| Web | Add the primary-nav entry, its `common.nav` label and update `registry.test.ts` (it pins the order); offline outbox handlers only if the spec says offline. Pick ONE project (`app`, `admin`, `marketing`) per `docs/content/web/projects.md`. | `task web:lint web:test` or `task app:lint app:test` |
| Android | Make the screen reachable (`AedstTab` or `navigator.navigate(<Name>Key)`), real repository behind the domain port, five `strings.xml` locales. | Gates in `apps/android/AGENTS.md`; `task android:lint android:test` if a JDK 21 exists |
| Apple | Wire the package into the app UI (route registration), not only the package graph. **Never compiled**: say so, do not claim it builds. | `task apple:lint` on macOS only |
| Desktop | Not generated and frozen: only after Core is green and the owner unfreezes Desktop, copy `crates/aedst-feature-tasks` to `aedst-feature-<id>` (Slint view in `ui/`, wired in `aedst-desktop/src/services.rs`). Verified on Windows only: say so. | `task desktop:lint` (tools missing print SKIPPED) |

For the same feature on the clients, continue with the `client-recipe` skill (eight steps).

## 3. Registries to double-check (the generator edits them; confirm the diff)

`cmd/server/modules.go`, `sqlc.yaml`, `MODULES` and `MODULES_REVERSE` in `apps/server/Taskfile.yml`, `scripts/lint-migrations.sh`, Helm `values.yaml`, `expectedModules` in `apps/server/architecturetest/layers_test.go`, web `registry.ts` / `messages.d.ts` / `test/render.tsx` / `bundle-budget.json`, Android `settings.gradle.kts` / `AppNavHost.kt`, `features.yaml`.

## 4. Done when

- [ ] `task check` is green (naming, file size, colors, i18n parity, boundaries, features, docs).
- [ ] The server `architecturetest` suite passes (`task server:check` runs it).
- [ ] The i18n parity check passes for all five locales.
- [ ] The spec is `Status: Implemented`.
- [ ] The report says, per platform, what ran and what did not (use `verify-status`).
