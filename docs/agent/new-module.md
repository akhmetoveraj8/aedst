# Adding a module

`task new:module -- NAME=<id>` stamps a minimal feature module on all five platforms and registers it. Implementation:
[`scripts/new-module.mjs`](../../scripts/new-module.mjs) (CLI), [`scripts/new-module-registries.mjs`](../../scripts/new-module-registries.mjs)
(registry edits), [`scripts/templates/`](../../scripts/templates/) (plain text templates), test:
`node --test scripts/new-module.test.mjs`.

```
task new:module -- NAME=reports                      # all platforms + registries + sqlc/buf codegen
task new:module -- NAME=reports --dry-run            # print the plan, write nothing
task new:module -- NAME=reports --platforms=server,web
task new:module -- NAME=reports --remove             # undo a stamp that git does not track yet (--force overrides)
```

`NAME` is one lowercase word (2-24 letters or digits, like `tasks`, `search`). The command refuses to overwrite files,
refuses names that exist on any platform or are reserved, and every registry edit is idempotent (marker-free: it looks
for the exact line it would add). With a partial `--platforms` set `features.yaml` is not edited, so `task check:features`
stays red until you declare the module by hand.

## What each template covers

| Platform | Stamped | Registered in |
|---|---|---|
| Server | proto + `<Name>Service` (Create/Get entry, owner from the token), `api/`, `domain/`, `application/` (ports + service + test), `infrastructure/postgres` (sqlc), `transport/`, `module/module.go` (`modulekit.Register`), `migrations/<name>/00001`, `sql/<name>/queries.sql`, `specs/<name>/` | `cmd/server/modules.go`, `sqlc.yaml`, `MODULES` and `MODULES_REVERSE` in `apps/server/Taskfile.yml`, `scripts/lint-migrations.sh`, Helm `values.yaml`, `expectedModules` in `architecturetest/layers_test.go`; runs `buf generate --path` and `sqlc generate` |
| Web | `manifest.ts`, `public.ts`, `i18n/{en,ru,tj,uz,ar}.json`, `ui/<Name>Page` + test, the `(app)/<name>/page.tsx` route | `registry.ts`, `messages.d.ts`, `test/render.tsx`, `bundle-budget.json` |
| Android | `feature/<name>` (`domain`, `data` with a Hilt binding, `presentation`, `navigation`), `strings.xml` in 5 locales, a ViewModel test | `settings.gradle.kts`, `app/build.gradle.kts`, `AppNavHost.kt` (`featureGraphs`), `<Name>Key` in `core/navigation/AedstKey.kt` |
| Apple | `Features/<Name>` Swift package (Domain, Data, Presentation, Navigation, `Localizable.xcstrings`, Swift Testing test) | `App/Shared/Package.swift` |
| Desktop | `Modules/Features/<Name>` (Domain, Data, Presentation, Navigation, `i18n/*.ts`, GoogleTest) | `CMakeLists.txt`, `App/CMakeLists.txt` |
| All | | `features.yaml` |

## What it deliberately does not do

- **No client RPC code.** Client generation output is gitignored, so clients get an in-memory repository behind a domain
  port; swap in the generated client when you add real behaviour (copy `tasks`).
- **Web has no primary-nav entry and no offline outbox handlers.** `registry.test.ts` pins the navigation order; add the
  `nav` entry, its `common.nav` label and update that test when the screen is real.
- **Android has no way to reach the screen yet** (no tab, no deep link): add an `AedstTab` or a `navigator.navigate(<Name>Key)`.
- **Apple and Desktop** are wired into the package/CMake graph but not into the app UI (no route registration, no plugin,
  no QML view). They were never compiled here; the first Mac/Qt build is their acceptance test.
- No integration test, event publisher, River job or idempotency key on the server; copy them from `tasks` when needed.

After stamping: replace the placeholder entry with the real aggregate, write the spec in `apps/server/specs/<name>/`, and run
`task check`, `task server:check`, `task web:lint web:test` (or the single project: `task app:lint app:test`), and the Android gates in `apps/android/AGENTS.md`.
