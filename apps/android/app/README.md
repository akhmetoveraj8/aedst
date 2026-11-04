# app

The phone/tablet application module and composition root: `MainActivity`, `AedstApplication`, Hilt's
`SingletonComponent`, the Navigation 3 shell (`navigation/AppNavHost.kt`: one back stack per tab, adaptive navigation
bar/rail) and `MainViewModel`. There are no product flavors; the build types are `debug` and `release` (source sets
`src/main`, `src/debug`). The Android TV counterpart is `../app-tv`; both get their cross-cutting build setup from
`AndroidApplicationConventionPlugin` (build-logic).

Rules for this module live in the root [AGENTS.md](../../../AGENTS.md), the
[Android conventions](../../../docs/agent/conventions/android.md) and the
[Android library-first page](../../../docs/content/library-first/android.md). Feature modules never
depend on each other; only this module wires them together, and it imports only each feature's `navigation` package.

## What lives here

| Piece | What it does |
|---|---|
| `AedstApplication` | on-demand WorkManager (Hilt worker factory), runs every module's `AppInitializer` (telemetry first), StrictMode in debug |
| `MainActivity` | splash held until the session is restored; edge-to-edge; offline banner, failed-writes alert and update prompt above the nav host; the forced-upgrade screen replaces everything |
| `MainViewModel` | session, connectivity, capabilities (which tabs exist), pending deep link, queued writes that failed |
| `OutboxFailedAlert` | shown under the offline banner while queued writes are parked as failed: retry (requeue) or discard (`OutboxRepository`) |
| `UpdateRecommendedBanner` | the dismissible "new version" prompt (`UPDATE_STATUS_RECOMMENDED`) |
| `navigation/AppNavHost` | composes every feature's `AedstNavGraph`, drives the tabs from capabilities and the admin role, reports screen views |

## Deep links

Two sources, one validation (`AedstRoutes`): the `link` extra of a notification tap, and **Android App Links**: an
`ACTION_VIEW` of `https://<host>/tasks/<id>` (also `/media`, `/notifications`, `/search`, `/admin`) whose *path* is the
in-app link. The intent filter is `autoVerify`; the host is the manifest placeholder `appLinkHost`
(`-Paedst.appLinkHost=app.example.com`, default `app.aedst.example`, which no real domain verifies). For the OS to open
the links without a chooser, the host must serve `/.well-known/assetlinks.json` listing this package and the signing
certificate: start from [`assetlinks.json.example`](assetlinks.json.example) and serve it from the web app (that is a
web-side change; nothing here hosts it). Unverified on a device.

## Build-time wiring

- **Release gate**: `preReleaseBuild` depends on `:core:network:verifyReleaseCertPins` (from the convention plugin, for
  `app` and `app-tv`): pass `-Paedst.certPins=...` or deliberately `-Paedst.allowUnpinnedRelease=true`.
- **Version**: `versionCode` from `AEDST_VERSION_CODE` (or CI's `GITHUB_RUN_NUMBER`, else 1); `versionName` from
  `aedst.versionName`.
- **Locales**: `generateLocaleConfig = true` and `res/resources.properties` (`unqualifiedResLocale=ru`) give the system
  language picker ru, en, tg, uz and ar.
- **Debug only**: LeakCanary (`debugImplementation`), StrictMode, the user-CA debug override and cleartext to the
  emulator host (`src/debug`).
- **Sentry**: the Gradle plugin uploads the R8 mapping when `SENTRY_AUTH_TOKEN` is set.
- **Baseline profile**: the `baselineProfile` plugin and the `:benchmark` module can record one, but **none has been
  recorded yet** (needs a device). Release builds ship without a profile until
  `./gradlew :app:generateBaselineProfile` has run and `app/src/release/generated/baselineProfiles` is committed;
  `scripts/check-baseline-profile.sh` says so in CI.

## Verification status

`./gradlew testDebugUnitTest :app:assembleDebug :app-tv:assembleDebug lintDebug ktlintCheck detekt` passes on the JVM (see
[status](../../../docs/content/status.md)). This module has no unit tests of its own (the logic it composes is tested in
the feature and core modules). Nothing has run on a device or emulator.
