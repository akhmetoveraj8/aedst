# @aedst/i18n

Single source of truth for translations. One JSON format on every platform: a translation written for one app works unchanged on every other. Rule: [docs/content/i18n.md](../../docs/content/i18n.md#one-json-translation-format-on-every-platform-mandatory).

## Layout

`<module>/<locale>.json` with locale in `en`, `ru`, `tg`, `uz`, `ar` (`common` is the app-shell module). Nested objects, `camelCase` keys, ICU MessageFormat subset: `{name}` arguments and at most one `{count, plural, one {# item} other {# items}}` per message (`#` is the count). `select`, number and date styles are rejected. Argument order must match `en` (Desktop `{}` cannot reorder).

## Commands

| Command | What it does |
|---|---|
| `node build.mjs --check` | Validates keys, arguments, plural syntax and that the committed Web copies match (`task check:i18n` runs it) |
| `node build.mjs --write-android` | Also overwrites the generated `strings.xml` of the Android modules listed in `ANDROID_HOMES` (`lib/targets.mjs`); `--check` fails when one is stale |
| `node build.mjs --write-apple` | Also overwrites the String Catalogs of the Apple feature modules in `APPLE_HOMES` (only modules that have an `apple-local.json`); `--check` fails when one is stale |
| `node build.mjs --write-desktop` | Also overwrites the `.po` catalogues of the Desktop crates in `DESKTOP_HOMES` (only modules that have a `desktop-local.json`); `--check` fails when one is stale |
| `node import-desktop.mjs [--apply]` | Migration tool: merges the Desktop `.po` catalogues into the shared JSON by identical English text; new strings get a key named after their first words |
| `node import-apple.mjs [--apply]` | Migration tool: merges hand-written Apple strings into the shared JSON (existing shared text wins) and keeps the inexpressible ones in `<module>/apple-local.json` |
| `node import-android.mjs [--apply]` | Migration tool: merges hand-written Android strings into the shared JSON (web text wins on a clash) and writes `targets.json` |
| `node build.mjs` | Writes the committed Web copies to `apps/web/shared/i18n/catalogs/<module>/` and `generated/android` (`strings.xml`), `generated/apple` (`.xcstrings`), `generated/desktop` (`.po`); `generated/` is git-ignored |

## targets.json

`<module>/targets.json` maps a key to the platforms that use it (`web`, `android`, `apple`, `desktop`). A key that is absent, or a module without the file, is used by every platform: that is the end state. During the migration it records the real state, so a key listed as `["web"]` is a worklist item for the other platforms. Web copies and native outputs contain only their own keys.

## Status

All four platforms consume the shared files. All three Web projects (app, admin, marketing) read copies in `apps/web/shared/i18n/catalogs/` (Turbopack and the Docker image cannot reach `packages/`); Web-only modules (`marketing`, `legal`, `admin-common`, `marketing-common`) are marked `["web"]` in `targets.json`. Android (`feature/*`, `app`, `core/ui`, `core/media`), Apple (all nine catalogs) and Desktop (all six crates) are generated and committed; leftovers the format cannot express stay in `strings_local.xml`, `<module>/apple-local.json` and `<module>/desktop-local.json`. Android `app-tv` is hand-written (one non-translatable string). Per-platform key prefixes are in `lib/targets.mjs`.

The `import-*.mjs` tools are one-shot migrations: run them once per module and platform, never again on a module that was already imported (a second run can match the wrong key, because several keys can normalise to the same name). Verification: Android compiles with the generated files; Apple and Desktop output is UNVERIFIED (never compiled / no Rust toolchain), checked only statically.
