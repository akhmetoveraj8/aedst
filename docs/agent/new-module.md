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
| Server | proto + `<Name>Service` (Create/Get entry, owner from the token), `api/`, `domain/`, one feature `features/entries/{application (ports + service + test),infrastructure/postgres (sqlc),transport}`, `module/module.go` (`modulekit.Register`, composes the feature), `migrations/<name>/00001`, `sql/<name>/queries.sql`, `specs/<name>/` | `cmd/server/modules.go`, `sqlc.yaml`, `MODULES` and `MODULES_REVERSE` in `apps/server/Taskfile.yml`, `scripts/lint-migrations.sh`, Helm `values.yaml`, `expectedModules` in `architecturetest/layers_test.go`; runs `buf generate --path` and `sqlc generate` |
| Web | `manifest.ts`, `public.ts`, `entries/<name>-page.ts`, `i18n/{en,ru,tj,uz,ar}.json`, one feature `features/overview/ui/<name>-page.tsx` (`<Name>Page`) + test, the `(app)/<name>/page.tsx` route (imports the entry) | `registry.ts`, `messages.d.ts`, `test/render.tsx`, `bundle-budget.json` |
| Android | `feature/<name>` (`domain`, `data` with a Hilt binding, `presentation`, `navigation`), `strings.xml` in 5 locales, a ViewModel test | `settings.gradle.kts`, `app/build.gradle.kts`, `AppNavHost.kt` (`featureGraphs`), `<Name>Key` in `core/navigation/AedstKey.kt` |
| Apple | `Features/<Name>` Swift package with five targets (`<Name>Domain`, `<Name>Data`, `<Name>Presentation` with `Localizable.xcstrings`, `<Name>UIiOS`, `<Name>UIMac`) and a Swift Testing test | `App/Shared/Package.swift` (the three shared products), `Tuist/Package.swift`. By hand: `featureNames` in `Project.swift` and the destinations in `App/iOS/Sources/FeatureDestinations.swift` and `App/macOS/Sources/FeatureDestinations.swift` |
| Desktop | `Modules/Features/<Name>` (Domain, Data, Presentation, Navigation, `i18n/*.ts`, GoogleTest) | `CMakeLists.txt`, `App/CMakeLists.txt` |
| All | | `features.yaml` |

## Adding a feature to an existing module

`task new:feature -- MODULE=<module> NAME=<feature> [--platforms=server,web] [--project=app|admin] [--dry-run] [--remove]`
runs [`scripts/new-feature.mjs`](../../scripts/new-feature.mjs), the shared CLI. The default platform is `server`; a
platform is stamped only when it is listed, and each platform is a hook in that file (`PLATFORM_HOOKS`; the frozen
platforms have none). `NAME` is lowercase words joined by `-` (`archive`, `bulk-edit`). Test:
`node --test scripts/test/new-feature.test.mjs`. Rules the result must keep:
[modules and features](../content/architecture/modules-and-features.md).

### Server

Stamps `apps/server/internal/modules/<m>/features/<f>/application/{service.go,service_test.go}` from
`scripts/templates/server/feature/**/*.ftmpl` (a sample use case behind a port, with a fake-repository test). The
folder is a Go package path element, so hyphens are dropped (`bulk-edit` becomes `bulkedit`). It edits no file:

- wire the feature in `<m>/module` yourself; `architecturetest` (`TestEveryFeatureIsComposedByItsModule`) fails until
  that package imports it;
- add `domain/`, `infrastructure/postgres` and `transport/` when the feature needs them (the only directories a
  feature may hold); SQL goes in `sql/<m>/queries.sql`, RPCs in the module's proto, contracts in `<m>/api`;
- in a module that was flat, move the existing capability into a feature in the same change (the generator prints
  this; a module-level `application/` beside `features/` fails the layout gate).

`--remove` deletes an untouched stamp only; it refuses when the folder holds files it did not create.

### Web

`node scripts/new-feature-web.mjs MODULE=<module> NAME=<feature> [--project=app|admin] [--dry-run] [--remove]` is the web part of
`task new:feature -- MODULE=<m> NAME=<f> --platforms=web` (same flag names; the shared CLI calls its exported `scaffoldWebFeature`). It stamps
`src/modules/<m>/features/<f>/ui/<f>-view.tsx` and its test from `scripts/templates/web/feature/**/*.ftmpl`, adds one export line to
`public.ts` in Biome's sort order and the key `<featureKey>.title` to the five catalogues (English text everywhere: translate it).
`NAME` is kebab-case (`bulk-edit`). Marketing is not supported (Server Components, no component-test harness). Test:
`node --test scripts/test/new-feature-web.test.mjs`. Rules the result must keep: [modules and features](../content/architecture/modules-and-features.md).

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
