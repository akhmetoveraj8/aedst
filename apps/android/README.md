# aedst-android

The AEDST Android client: a multi-module app mirroring the module boundaries
of `apps/server` (see [../../docs/content/android/architecture.md](../../docs/content/android/architecture.md),
[../../docs/content/server/architecture.md](../../docs/content/server/architecture.md) and
[../../docs/content/server/modules.md](../../docs/content/server/modules.md) — or the published docs site).

> **Verification status (2026-10-08).** Verified on the JVM: `./gradlew testDebugUnitTest :app:assembleDebug :app-tv:assembleDebug lintDebug ktlintCheck detekt` passes (JDK 21, Android SDK; see [status](../../docs/content/status.md)). **Never run on a device or emulator:** Keystore/Tink paths, AppAuth sign-in, Play Integrity, FCM/Firebase with a real `google-services.json`, `androidTest` (Accessibility Test Framework), benchmarks and baseline-profile generation.

## Module map

```
app/                        phone/tablet application module — Hilt entry point, Navigation 3 shell, App Links, wires every feature
app-tv/                     thin Android TV application module (device sign-in, upgrade screen); same convention plugin as app/

core/common                 Outcome/AedstError, DispatcherProvider, UseCase base classes
core/ui                     Compose theme + reusable components
core/network                Generated ConnectRPC/Protobuf client (connect-kotlin) over OkHttp: auth interceptor, 401 refresh authenticator, TLS pinning, NetworkMonitor, error mapping — run `make generate` first (see buf.gen.yaml)
core/database                Room (AppDatabase, BaseDao, outbox table) — unencrypted: non-sensitive data only
core/outbox                    Offline write queue: OutboxRepository + WorkManager OutboxSyncWorker + OutboxHandler contract + OutboxSignOutHook (queue is wiped when the session ends); feature/tasks has the reference handlers
core/datastore               Proto DataStore
core/security                Android Keystore + Tink AEAD encrypted store (DataStore) + Play Integrity facade
core/capabilities            Capability negotiation: GetCapabilities (unauthenticated), last-known cache in DataStore, CapabilityResolver (built AND server-enabled), min/recommended versions feed the forced-upgrade latch
core/analytics               Telemetry: Sentry (crashes, errors, OkHttp spans + traceparent, nav breadcrumbs) + PostHog (consent-gated analytics, feature flags)
core/navigation               Navigation 3 keys (AedstKey), AedstNavGraph/AedstNavigator contract, AedstRoutes (+ keyForLink for server in-app links) — the feature/api boundary
core/media                    MediaService repository, upload pipeline (Photo Picker → WorkManager: compress + CreateUpload → presigned PUT → CompleteUpload), Coil images, Media3 player/Transformer, local thumbnails
core/testing                  MockK/Turbine/coroutine test rules shared across feature tests, plus assertScreenSemantics (touch target + spoken label check every *ScreenTest uses)

feature/auth                 complete worked example: domain/data/presentation/navigation (+ analytics consent toggle); OIDC sign-in via AppAuth, see "Sign-in (OIDC)"
feature/tasks                tasks list / detail / create; attachments on the detail screen (core/media)
feature/search               debounced search-as-you-type, U+E000/U+E001 snippet highlighting
feature/notifications        inbox, unread badge, mark read, preferences; FCM push (channels, token sync, deep links)
feature/media                media library + image/video viewer
feature/admin                overview/users/tasks/audit — only shown for the `admin` role from the access token

benchmark/                    Macrobenchmark + Baseline Profile module: startup (None vs profile), task-list scroll (opt-in, needs a test account), profile generator
build-logic/                  convention plugins (composite build, not buildSrc)
```

Dependency direction: `feature/*` -> `core/*`, never the reverse; never
`feature/*` -> `feature/*` except through `core/navigation`'s typed
navigation keys. See [../../docs/content/android/architecture.md](../../docs/content/android/architecture.md)
for the full rule and how it maps to the server's `api/` boundary.

## Build locally

Requires the Android SDK (compileSdk 37) and JDK 21 (project toolchain pin;
detekt 2 no longer blocks newer JDKs, but JDK 25 is unverified). Generate the ConnectRPC stubs first (needs the `buf` CLI), then:

```bash
make generate                                                  # buf codegen into core/network/src/main/kotlin-gen
cp app/google-services.json.example app/google-services.json   # placeholder is enough to compile
./gradlew detekt ktlintCheck testDebugUnitTest
```

| Command | What it does |
|---|---|
| `./gradlew detekt` | static analysis |
| `./gradlew ktlintCheck` / `ktlintFormat` | formatting check / autofix |
| `./gradlew testDebugUnitTest` | JVM tests (JUnit 6 Jupiter; Robolectric and Compose-rule tests stay JUnit 4 and run through the vintage engine, see gradle/libs.versions.toml; MockK, Turbine, MockWebServer, Robolectric for Compose/Room/Worker). Includes the proto contract test (skipped locally unless `make descriptors` ran; `AEDST_REQUIRE_CONTRACT=1` makes it mandatory, as in CI) and the Roborazzi tests, which capture nothing in a plain run |
| `make descriptors` | proto descriptors as JSON (`buf build ../server/api/proto`) for `core/network`'s `ProtoContractTest`; `make generate` runs it too |
| `bash scripts/check-room-schemas.sh` | the exported Room schema of the current `AppDatabase.VERSION` is committed (`core/database/schemas`); CI runs it, `AppDatabaseSchemaTest` opens it as the real database |
| `bash scripts/check-policies.sh` | Library-First guards plus `check-color-literals.sh` (no `Color(0x...)` outside generated theme files) and `check-file-size.sh` (300 green / 400 warn / 500 fail) |
| `./gradlew :core:ui:recordRoborazziDebug` | record the golden screenshots into `core/ui/src/test/snapshots` (commit them). Rendering differs per OS: record on Linux, i.e. run the `record-screenshots` job of android-ci (workflow_dispatch) and commit its `roborazzi-goldens` artifact |
| `./gradlew :core:ui:verifyRoborazziDebug` | fail on any pixel difference against the committed goldens (CI does this once goldens exist; uploads `roborazzi-diff` on failure) |
| `./gradlew connectedDebugAndroidTest` | Compose UI tests with Accessibility Test Framework checks — needs an emulator/device |
| `./gradlew :app:assembleRelease -Paedst.certPins=sha256/<live>,sha256/<backup>` | release build; refuses to assemble without pins (`-Paedst.allowUnpinnedRelease=true` to opt out) |
| `./gradlew :app:assembleDebug` | build the debug APK (talks to `http://10.0.2.2:8080/`, i.e. `task dev` on the host, unless `-Paedst.debugBaseUrl=...`; includes LeakCanary) |
| `./gradlew :benchmark:connectedBenchmarkReleaseAndroidTest -Pandroid.testInstrumentationRunnerArguments.androidx.benchmark.enabledRules=macrobenchmark` | Macrobenchmarks (startup `None` vs profile; task-list frame timing) — needs a physical device for real numbers; add `-Paedst.benchmark.suppressErrors=EMULATOR,LOW-BATTERY` for an emulator smoke run |
| `./gradlew :app:generateBaselineProfile` | record the baseline + startup profile into `app/src/release/generated/baselineProfiles` (commit it) — needs a device/emulator; also run by the `benchmarks` job of android-nightly. **No profile has been recorded yet**: that folder does not exist, release builds ship without a baseline profile, and the startup numbers in the benchmark notes are not measured |

Benchmark notes:

- Benchmarks and the profile generator run on `benchmarkRelease` / `nonMinifiedRelease`, debug-signed copies of `release` created by the baseline-profile plugin. The release TLS-pin guard (`verifyReleaseCertPins`) hangs on `preReleaseBuild` only, so these variants build without pins (they are unpinned: never ship them); `-Paedst.allowUnpinnedRelease=true` is only needed if a command also assembles `release`.
- Signed-out journeys (cold start, login screen) need nothing. The signed-in ones (task-list scroll, signed-in startup, signed-in part of the profile) are skipped with a message unless a ZITADEL test user is passed: `-Paedst.benchmark.email=<login name> -Paedst.benchmark.password=...` (or `AEDST_BENCHMARK_EMAIL` / `AEDST_BENCHMARK_PASSWORD`; `-Paedst.benchmark.submitLabel=<button text>` only if the app's sign-in button text is not one of the shipped translations). The user must have no MFA and no required password change, and the account needs more tasks than fit on a screen. Sign-in is OIDC, so `BenchmarkSession.signInIfNeeded` taps the app's single sign-in button (matched by its text, the screen has no test tag), then drives ZITADEL's hosted login in the Chrome Custom Tab: Chrome first-run screens, account chooser, login name (`loginName`), password (`password`), `submit-button` (ids from ZITADEL's login templates) and a possible skip-MFA/passkey prompt, each with a deadline. Run it on an English device with Chrome as the default browser. `benchmarkRelease`/`nonMinifiedRelease` are release-derived, so they keep the HTTPS-only network config: build them with `-Paedst.oidc.issuer=https://<zitadel>`, `-Paedst.oidc.clientId`, `-Paedst.oidc.projectId` and `-Paedst.baseUrl=https://<staging>/` (the local `http://10.0.2.2` stack only works in debug builds). This flow is UNVERIFIED (no emulator here). Other journeys (create/complete/search/notifications/admin) need `testTag` + `testTagsAsResourceId` on those screens and seed data.
- Accessibility: `core/ui` renders every public component through `ComponentCatalog` (`src/sharedTest`). JVM: Roborazzi screenshots (light, dark, 200 % font, Arabic RTL) and touch-target/label checks on the semantics tree; instrumented (`connectedDebugAndroidTest`, API 34+ only): the full Accessibility Test Framework run incl. colour contrast, light and dark. ATF does not work on Robolectric, so contrast is only checked on a device/emulator.

## Dependency and platform decisions

- **Versions policy**: latest *stable* release of every dependency, verified
  against Maven Central / Google Maven metadata (never alpha/beta/rc). Compose
  versions come from the BOM (`platform(libs.compose.bom)` in the compose
  convention plugin), not from individual pins.
- **AGP 9 with built-in Kotlin + Hilt 2.60.1** (DI decision). Weighed:
  (a) AGP 9 + latest Hilt versus (b) migrating to Metro or Koin. Chose (a). The
  AGP 9 migration is small (drop the `org.jetbrains.kotlin.android` plugin from
  the convention plugins and `benchmark`; KSP, Hilt, Compose and serialization
  plugins work unchanged). Hilt keeps compile-time graph validation and the
  first-party integrations this app uses (`hilt-lifecycle-viewmodel-compose`,
  `hilt-work`, `@HiltViewModel`) stay supported by Google. Metro is promising
  and KMP-ready, but this is an Android-only client, so KMP-readiness has no
  payoff today, and moving would mean replacing the Hilt navigation/work
  integrations and rewriting every module for no functional gain; Koin gives up
  compile-time safety. Revisit Metro only if a KMP shared module is introduced.
- **Secrets storage**: `androidx.security:security-crypto`
  (`EncryptedSharedPreferences`) is deprecated and removed. `core/security` now
  uses Android Keystore (non-exportable master key) + Google Tink AEAD
  (`AndroidKeysetManager`, AES-256-GCM) sealing a DataStore file
  (`AeadSerializer`). Data written by the old implementation is migrated once
  (`LegacyEncryptedPreferencesMigration`: read old, write new, then delete old);
  delete that class once all supported installs have upgraded.
- **connect-kotlin 0.10.0** (latest, verified on Maven Central 2026-10-28) on **OkHttp 5.5.1**
  (`connect-kotlin-okhttp` 0.10.0 links OkHttp 5.5.0; same 5.x API). OkHttp 5.5
  requires compileSdk 37. The repo is active (commits within days, a release
  every 1-3 months, 9 open issues) but is a small pre-1.0 project. **Plan B** if
  it stalls or breaks: apps/server (connect-go) also serves the gRPC and gRPC-Web
  protocols on the same handlers, so the client can move to **Wire** (Kotlin-first,
  KMP-capable, generates gRPC clients over OkHttp) or **gRPC-Kotlin**
  (`grpc-okhttp`) with no server change. Only `data/repository` classes touch the
  generated stubs, so the swap stays local to `core/network` and each feature's
  `data` package.

## Sign-in (OIDC, Authorization Code + PKCE)

The app signs in against the server's identity provider (ZITADEL by default, ADR-0001), not against first-party
`AuthService.Login` (that RPC is only mounted while `AEDST_AUTH_FIRST_PARTY_ENABLED=true`, which is off by default and
time-boxed). `feature/auth` uses **AppAuth-Android 0.11.1**: the system browser (a Custom Tab where the default browser
supports it, never a WebView, RFC 8252), PKCE S256, `state` and `nonce`, then the code exchange at the token endpoint.
Passkeys, MFA, social login and account recovery are ZITADEL's hosted login in that browser tab; there is no native
credential UI and no `androidx.credentials` dependency (decision and revisit trigger:
[../server/deployments/zitadel/android-app.md](../server/deployments/zitadel/android-app.md)).

| What | Where | Effect when missing |
|---|---|---|
| `-Paedst.oidc.issuer` / `AEDST_OIDC_ISSUER` | Gradle property or env (`feature/auth/build.gradle.kts`) | debug: `http://10.0.2.2:8085` (local ZITADEL via the emulator); release: sign-in shows "not configured" |
| `-Paedst.oidc.clientId` / `AEDST_OIDC_CLIENT_ID` | same (client id of the ZITADEL Native app) | sign-in shows "not configured" (no crash) |
| `-Paedst.oidc.projectId` / `AEDST_OIDC_PROJECT_ID` | same (ZITADEL project id) | no project audience scope: the server answers 401 |
| `appAuthRedirectScheme` manifest placeholder | `app/` and `app-tv/` `defaultConfig` (= `applicationId`) | AppAuth cannot receive the redirect |

- **Redirect URI** `com.aedst.android:/oauth2redirect`: a reverse-DNS private-use scheme (RFC 8252 section 7.1), built
  from the application id at runtime; it must be registered at the IdP. Any app can claim a custom scheme, but PKCE
  makes an intercepted code useless. **Hardening option:** Android App Links (an `https://` redirect on your own domain
  plus `/.well-known/assetlinks.json`, verified by the OS) removes that interception class; AppAuth supports it by
  changing the redirect URI and the manifest intent filter.
- **Scopes**: `openid profile email offline_access` plus `urn:zitadel:iam:org:project:id:<projectId>:aud` (puts the
  project in the access token `aud`, which the server validates) and `urn:zitadel:iam:org:project:roles`. The access
  token must be a **JWT** (app setting in ZITADEL); an opaque token is rejected at sign-in with a clear message.
- **Session**: tokens are stored exactly as before (Tink + Keystore, `AuthTokenStore`). `sub` of the ID token is the
  user id. A 401 triggers one `refresh_token` grant (single-flight); ZITADEL rotates the refresh token, the new one is
  stored. `invalid_grant` ends the session, offline/5xx keeps it.
- **Device attestation (Play Integrity, informational)**: after a successful sign-in is saved, `SignInAttestation`
  fires one best-effort, non-blocking call on the application scope: a Play Integrity standard token bound to a fresh
  random payload (`request_hash = base64url_nopad(SHA-256("aedst.integrity.v1\n" + "login" + "\n" + payload))`) goes
  to `IntegrityService.VerifyIntegrityToken`, and only `{verified, reason, device}` is reported as the
  `device_attestation` analytics event (consent applies). It never blocks or alters sign-in and nothing enforces the
  verdict yet (server ADR-0002). It needs the Play Console cloud project number
  (`-Paedst.playIntegrityCloudProject=<number>` / `PLAY_INTEGRITY_CLOUD_PROJECT`; unset = the facade fails fast) and the
  server flags `AEDST_INTEGRITY_ENABLED=true` plus `AEDST_INTEGRITY_*` (allowed packages, Google credentials);
  a disabled server (FAILED_PRECONDITION), no Play Services or offline are swallowed and logged at debug.
- **Sign-out**: sign-out hooks, then best-effort RFC 7009 revocation (5 s bound, via `@ExternalHttpClient`), then the
  local session is cleared. The browser's IdP session is **not** ended; the authorization request uses
  `prompt=select_account` so the user has to pick an account instead of being silently signed back in. Shared-device
  products that need a full IdP logout should add an RP-initiated `end_session` (AppAuth `EndSessionRequest`; register
  a post-logout redirect URI) or switch to `prompt=login`.
- **Process death / rotation**: the pending request lives in AppAuth's management activity state and travels back
  inside the result; the view model keeps a "browser flow pending" flag in `SavedStateHandle` and ignores results it did
  not ask for.
- **Android TV (device flow)**: `app-tv` usually has no browser, so `AuthNavGraph(useDeviceFlow = true)` renders the
  OAuth 2.0 Device Authorization Grant (RFC 8628) on `LoginKey` instead of AppAuth's browser flow (phone unchanged).
  The TV shows a large user code plus the verification URL (and the `verification_uri_complete` link as text; there
  is no QR code, Android has no QR encoder and a library was not warranted) and polls the token endpoint
  (`OkHttpDeviceAuthorizer`, the `@ExternalHttpClient`): `interval` seconds apart, +5 s on `slow_down`, exponential
  back-off on network/5xx errors, stop on `access_denied` / `expired_token` / the local deadline. Tokens go through
  the same mapping as the browser flow (JWT access token, refresh token and `sub` required) into `AuthTokenStore`.
  IdP settings (ZITADEL): the application used by the TV (`AEDST_OIDC_CLIENT_ID` is shared by `feature/auth`, so
  by default the same Native app as the phone) must be a public client (auth method None) with grant types
  **Device Code** + **Refresh Token** (+ Authorization Code for the phone) and access token type **JWT**; discovery
  must list `device_authorization_endpoint` (`/oauth/v2/device_authorization`); no redirect URI is used by the TV
  flow, and the user approves at the instance's `/device` page.
- Debug builds against a plain-http issuer need a debug-only cleartext exception in the network security config
  (the production config is https-only).

## Telemetry, push and media (configuration)

Nothing below is required to build or run the template; an empty value disables that integration.

| What | Where | Effect when missing |
|---|---|---|
| `app/google-services.json` (Firebase project, FCM only) | gitignored; `google-services.json.example` is a placeholder | google-services plugin not applied, no FirebaseApp, push registration skipped |
| `-Paedst.sentryDsn` / `SENTRY_DSN` | Gradle property or env (core/analytics) | Sentry not initialised |
| `SENTRY_AUTH_TOKEN`, `SENTRY_ORG`, `SENTRY_PROJECT` | CI env (Sentry Gradle plugin) | R8 mapping not uploaded (UUID still embedded) |
| `-Paedst.posthogKey` / `POSTHOG_KEY`, `-Paedst.posthogHost` | Gradle property or env | PostHog not initialised; flags return defaults |
| `-Paedst.environment` | Gradle property or env | `development` (debug) / `production` (release) |

- **Errors**: Connect codes map to typed `AedstError` kinds (`core/network/ApiError.kt`), shown as localized
  snackbars via `AedstErrorSnackbarEffect` (`core/ui`). Uncaught exceptions: Sentry's handler; application-scope
  coroutine failures: `ErrorReporter` (non-fatal).
- **Tracing**: the API OkHttp client ends with Sentry's interceptor (spans, breadcrumbs, W3C `traceparent` to the
  API host only); without Sentry, `RequestHeadersInterceptor` still sends a random `traceparent`.
- **Analytics** is opt-in (Account screen toggle, stored in `UserPrefs.analytics_consent`), like web's consent cookie.
- **Push**: FCM `data` keys expected from the server: `kind`, `title`, `body`, `link` (relative route such as
  `/tasks/<id>`), `notification_id`. Links are validated by `AedstRoutes.routeForLink` before navigating.
- **Media**: Photo Picker (no storage permission) → `MediaUploadScheduler` → WorkManager chain
  `PrepareUploadWorker` (ImageDecoder/WEBP or JPEG, Media3 Transformer H.264 720p, SHA-256, `CreateUpload`) →
  `TransferUploadWorker` (presigned PUT with progress, foreground `dataSync`) → `CompleteUploadWorker`. A retry
  restarts only the failed step.

## Dependency updates

**Renovate** (root `renovate.json`) is the single updater for the whole monorepo, Gradle included: it reads
`gradle/libs.versions.toml`, `*.gradle.kts` and the wrapper, proposes stable releases only, and groups related bumps
(Kotlin + KSP + Compose compiler + AGP + Hilt in one PR; androidx/Compose; protobuf + connect + OkHttp; telemetry; test
stack). The earlier in-repo `ben-manes` / `version-catalog-update` Gradle plugins were removed - two updaters
disagreeing about the same catalog is worse than one. `detekt` is on 2.0.0-alpha.6 (`dev.detekt`) as a documented pre-release exception; Renovate may propose
newer `dev.detekt` pre-releases only, until 2.0.0 stable (decisions.md). On-demand wrapper bump: `task deps:update` (`scripts/update-deps.sh android`).
Every Renovate PR must keep `docs/content/library-first.md` and `docs/content/android/stack.md` in sync when a
documented version moves.

## Release build (R8)

R8 full mode, `isShrinkResources`, and where each keep rule lives (protobuf-lite has none of its own and is the usual
release-only crash): [docs/content/android/r8.md](../../docs/content/android/r8.md).

## Deliberate scope cuts (see the task's own notes for the full list)

- **Metalava / binary-compatibility-validator**: not wired. It matters most
  for a published library API surface; this app has none yet. TODO once
  `core/*` modules are consumed outside this repo.
- **SonarCloud**: no live project (needs an external account/token). A
  `sonar-project.properties` shape to add when one exists:
  ```properties
  sonar.projectKey=aedst_android
  sonar.organization=<org>
  sonar.sources=app/src/main,core,feature
  sonar.tests=app/src/test,core,feature
  sonar.java.binaries=**/build/intermediates/javac/**/classes
  sonar.kotlin.source.version=2.4
  ```
- **Fastlane**: not installed (needs Play Console / App Store Connect
  credentials). CI builds debug and release APKs and `android-release.yml` builds the bundles, but nothing uploads to Play; a real pipeline would add a
  `fastlane/Fastfile` with `internal` -> `beta` -> `production` Play tracks.
- **architecturetest equivalent**: `scripts/check-feature-boundaries.sh`,
  wired into `android-ci.yml`'s `lint` job — see
  docs/content/android/architecture.md's "Boundary enforcement" section.
