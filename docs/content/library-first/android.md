---
title: "Library-First: Android stack"
description: "Part of the Library-First standard. Principles, version policy, explicit rejections and the Definition of Done are in General rules."
---

# Library-First: Android stack

Part of the [Library-First standard](../library-first.md). Principles, version policy, explicit rejections and the Definition of Done are in [General rules](general.md).

Kotlin, Jetpack Compose (BOM via `platform()`), Hilt (DI), Coroutines + Flow, **Navigation 3** (`androidx.navigation3`), WorkManager, Kotlin Serialization (only for navigation keys and local JSON), JUnit 6 (Jupiter) in every module (the vintage engine only where Robolectric, Compose rules or `AndroidJUnitRunner` need JUnit 4) + AndroidX/Compose testing. UI lives in `apps/android/core/ui/`. **JDK 21 is mandatory** (the project toolchain pin; JDK 25 with detekt 2 has not been verified). Run `make generate` (buf) before the first build. Versions: latest stable only.

| Responsibility | Tool |
|---|---|
| API client | generated Protobuf + ConnectRPC (**connect-kotlin 0.10.0**) on top of **OkHttp 5.5.1** (compileSdk 37); **not Retrofit**. Suspending HTTP calls outside the generated client use **`okhttp-coroutines` 5.5.1** `Call.executeAsync()` (cancellation-aware), never a hand-written `suspendCancellableCoroutine` wrapper; hashing is okio `HashingSource` |
| DI | Hilt on AGP 9 with built-in Kotlin (no explicit `kotlin-android` plugin) |
| Local relational DB | **Room 3.0.3** (`androidx.room3`, KSP only, driven by `androidx.sqlite` `AndroidSQLiteDriver`; no SupportSQLite, no KAPT) |
| Typed key-value settings | DataStore + Protobuf |
| Image loading | Coil |
| Secret/token storage | Android Keystore + **Tink AEAD** (`AndroidKeysetManager`), encrypted DataStore serializer |
| Offline write queue / background delivery | Room (outbox table) + **WorkManager** (`core/outbox`); Hilt-Work for `@HiltWorker`; **not** a custom scheduler, not polling, not `AlarmManager`. A feature adds an `OutboxHandler` per write type (`feature/tasks`: `task.create`, `task.complete`, `task.update`), sends the outbox id as `Idempotency-Key` (`idempotencyHeaders()` in `core/network`), and direct writes send a fresh key per call |
| Network state | `ConnectivityManager.registerDefaultNetworkCallback` (platform API, `core/network`), no third-party libraries |
| Splash / edge-to-edge | `androidx.core:core-splashscreen` **1.2.0** + `enableEdgeToEdge()` |
| Navigation | **Navigation 3 1.2.0** (`navigation3-runtime/ui`, `lifecycle-viewmodel-navigation3` 2.11.0): the back stack is owned by the app (lists of `@Serializable NavKey`, one stack per tab, sign-out clears all stacks); the adaptive shell is `material3-adaptive-navigation-suite` (from the BOM). Navigation Compose 2.x and `hilt-navigation-compose` are not used; a ViewModel with an argument is `@HiltViewModel(assistedFactory)` + `hiltViewModel(creationCallback)`, not `SavedStateHandle` |
| Sign-in (OIDC) | **AppAuth-Android 0.11.1**: Authorization Code + PKCE (S256) in a Custom Tab (RFC 8252), **not a WebView**; refresh grant and revoke (RFC 7009, via the existing OkHttp); the refresh token lives only in Tink storage. Passkeys/MFA/social/recovery are ZITADEL's hosted login; **do not add `androidx.credentials`** until there is our own UI over the Session API (Digital Asset Links would also be needed then). Config: `aedst.oidc.issuer/clientId/projectId` |
| TV sign-in | OAuth 2.0 Device Authorization Grant (RFC 8628) over the existing OkHttp (`feature/auth`, `AuthNavGraph(useDeviceFlow = true)`); IdP JSON is parsed as a kotlinx.serialization tree (not an API payload); no QR library |
| JVM tests | **JUnit 6.1.3 (Jupiter)** is the default model, `junit:junit` was removed from the catalog; the vintage engine stays **only** in modules where Robolectric / Compose rules / AndroidJUnitRunner have no Jupiter equivalent (core/database, core/outbox, core/ui, core/ui-tv, core/security, feature/auth, feature/tasks, feature/media, benchmark). **Adaptive layouts:** `androidx.compose.material3.adaptive` **1.3.0** (approved; `currentWindowAdaptiveInfoV2`, `NavigableListDetailPaneScaffold`); do not write your own window-size code; Navigation 3 list-detail scenes are not accepted. **Robolectric 4.17** + Compose UI test + `room-testing` + `work-testing`, MockK, Turbine, `kotlinx-coroutines-test` |
| Screenshot tests | **Roborazzi 1.77.0** (`core/ui`, Robolectric native graphics: light/dark/200 % font/RTL); golden images are recorded in CI on Linux (`record-screenshots`) |
| Accessibility (axe analogue) | instrumented ATF checks via `ui-test-junit4-accessibility` (API 34+, does not work on Robolectric); on the JVM: target size >= 48dp and labels (`ComponentSemanticsTest`) |
| API contract test | `buf build -o descriptors.json` + kotlinx.serialization.json + reflection over the generated connect-kotlin clients (`ProtoContractTest`, `AppRpcContract`); as on web, the server is the source of truth |
| Performance | Macrobenchmark + Baseline Profiles (`benchmark/`: startup, scroll, profile generation), `profileinstaller` |
| Release build | R8 full mode + `isShrinkResources`; protobuf-lite keep rules live in `core/network/consumer-rules.pro` (protobuf-javalite does not ship them); see `docs/content/android/r8.md` |
| Emulator in CI | GitHub Action `reactivecircus/android-emulator-runner` (CI only, not an app dependency) |
| Anti-abuse / device attestation | Play Integrity API, **standard requests** (warm-up + a token per request); only meaningful with server-side verdict verification, which exists: module `integrity` (`aedst.integrity.v1`, see the Play Integrity row in the Server section). It is disabled by default; the client calls it once after sign-in (informational) and blocks nothing |
| Crash reporting / performance / tracing | **Sentry Android** (`sentry-android`, `sentry-okhttp` with `traceparent` only to the API host, Sentry Gradle plugin for R8 mapping), as on Web |
| Product analytics / feature flags | **PostHog Android**: opt-out until consent, disabled when the key is empty. **Session replay is off on Android**; if enabled, only in a single tool (`scripts/check-policies.sh`) |
| Push | **Firebase Cloud Messaging** (`firebase-messaging` via BoM); Firebase is used **only** for FCM; the google-services plugin is applied only when `google-services.json` is present |
| Media | **AndroidX Media3** (ExoPlayer + `ui-compose` for the player; Transformer for video compression), Coil 3 (images), Photo Picker (`PickVisualMedia`), `ImageDecoder` (image compression), WorkManager (upload: prepare → presigned PUT → complete) |
| Dependency updates | **Renovate** for the whole monorepo (Go, pnpm, Gradle catalog, wrapper; stable only, PR groups); `scripts/update-deps.sh android` only bumps the Gradle wrapper. The ben-manes/version-catalog-update plugins were removed |
| Static analysis | detekt **2.0.0-alpha.6** (`dev.detekt`, pre-release by owner decision, the only exception to stable-only; revisit at 2.0.0 stable): semantic rules only; formatting belongs entirely to ktlint (`.editorconfig`), overlapping detekt rules are disabled. Plus **compose-rules 0.6.8** (`io.nlopez.compose.rules:detekt`, its POM depends on `dev.detekt:detekt-core:2.0.0-alpha.6`, so it is compatible), **Kover 0.9.11** (per-module line-coverage floors in `kover-thresholds.properties`) and Android Lint as a hard gate (`warningsAsErrors`, `abortOnError`, `checkDependencies`, SARIF; `lint.xml`). Every library-first rule is a gate with a negative self-test, see "Enforced gates" below |
| TV lists | standard Compose lazy lists (`tv-foundation` is deprecated) |

**Secrets.** `androidx.security:security-crypto` (`EncryptedSharedPreferences`) is **deprecated and removed; do not use it**. Legacy data migrates as read → write → delete.

**Network.** The single source of truth is `apps/server/api/proto`. Retrofit + hand-written JSON DTOs are forbidden. OkHttp stays as the low-level HTTP engine under connect-kotlin. **Plan B**, if connect-kotlin becomes unmaintained: Wire / gRPC-Kotlin (the server also serves gRPC/gRPC-Web).

**DI.** Hilt is approved (see "Explicit rejections"). Metro only if KMP appears: KMP now exists for `core/common`, `core/database` and the feature domains, but all DI wiring is still Android code, so Hilt stays until network and data are common ([KMP structure](/android/kmp), step 6).

**Kotlin Multiplatform.** Shared code uses the `aedst.kmp.library` convention plugin (`org.jetbrains.kotlin.multiplatform` + `com.android.kotlin.multiplatform.library`, targets `android` and `jvm`, no iOS). Common code uses `kotlin.time`, `kotlin.uuid` and `kotlin.test`; no `java.*`, `javax.*` or `android.*` in `commonMain` (`check-feature-boundaries.sh`). Details: [KMP structure](/android/kmp). Koin was rejected (no compile-time checks).

**kotlinx.serialization** is only for navigation keys and local JSON (work data, secrets, JWT claims); the API uses Protobuf only (checked by `scripts/check-policies.sh`). Firebase is FCM only.

Do not write your own: navigation framework, DI framework, coroutine abstraction, image loader, serialization layer, lifecycle framework, HTTP/RPC client instead of the generated ConnectRPC client, cryptography on top of Keystore (use Tink).

## Enforced gates

Every "use library X for concern Y" rule above is a machine gate. Each gate has a negative self-test:
`apps/android/scripts/test-gates.sh` seeds one violation per gate into the working tree, proves the gate fails with the
expected rule id, and removes the seed (CI runs it in the `lint` job). The last column names a compliant call site to copy.

| Concern / rule | Gate (where it lives) | Worked example |
|---|---|---|
| No Retrofit, Moshi, Gson, RxJava, Koin, `security-crypto` | detekt `style>ForbiddenImport` (`apps/android/detekt.yml`) | `ConnectTaskRepository.kt` (generated ConnectRPC client) |
| No `GlobalScope`; no `Thread.sleep` | `ForbiddenImport`, `ForbiddenMethodCall`, `coroutines>GlobalCoroutineUsage` | an injected `@ApplicationScope CoroutineScope` |
| `collectAsStateWithLifecycle`, never `collectAsState` | `ForbiddenImport` | `TaskListScreen.kt` |
| `android.util.Log` and `Dispatchers.*` only in `core/common` (and `core/testing`) | `ForbiddenImport/MainThreadAndLogging`, `coroutines>InjectDispatcher` (type resolution) | `DispatcherProvider` in `PrepareUploadWorker.kt` |
| `okhttp3.*` only in `core/network`, `core/media`, `core/analytics`, `feature/auth` | `ForbiddenImport/OkHttpOutsideNetwork` | `PresignedUploader.kt` |
| Suspending OkHttp calls through `okhttp-coroutines` `executeAsync()`, no hand-written `await`; `runCatching` around suspend calls is rejected | `coroutines>SuspendFunSwallowedCancellation` (type resolution) | `OkHttpTokenRevoker.kt`, `PlayIntegrityFacade.kt` |
| Hashing with okio `HashingSource`; hex without `String.format` | `style>ImplicitDefaultLocale` | `PrepareUploadWorker.sha256Hex` |
| Raw Material 3 `IconButton`, `HorizontalDivider`, `FloatingActionButton`, `TextButton`, `FilterChip`, `AlertDialog`, `Badge`, `CircularProgressIndicator` banned in `feature/*`, `app`, `app-tv` (use `AedstIconButton`, `AedstDivider`, `AedstFab`, `AedstButton`, `AedstFilterChip`, `AedstAlertDialog`, `AedstCountBadge`, `AedstCircularProgressIndicator`) | `ForbiddenImport/Material3Raw` | `TaskListScreen.kt` (`AedstFab`, `AedstDivider`) |
| Compose best practice (modifier parameter, parameter order, stable lambdas, `@ReadOnlyComposable`, public previews) | `io.nlopez.compose.rules:detekt` added by `DetektConventionPlugin`; the `Compose:` block of `detekt.yml` lists each disabled rule with its reason | `AedstSelect.kt` |
| Type-resolved detekt always runs | `detekt` depends on `detektDebug` in `DetektConventionPlugin`, so `task android:lint` runs it | n/a |
| Android Lint is a hard gate | `lint { warningsAsErrors; abortOnError; checkDependencies; sarifReport }` in the library and application convention plugins plus `lint.xml` (`DataExtractionRules` is an error) | n/a |
| `kotlinx.serialization` never in API-facing code (`core/network`, `core/media`, `core/capabilities`, every `data` package); `@Serializable` banned there | `scripts/check-policies.sh` section 1 (allowlist with reasons inside the script) | `UploadWorkData.kt` (local JSON only) |
| Version catalog is a subset of the allowlist below | `scripts/check-catalog-allowlist.sh` | this page |
| Spacing and shapes from tokens (`AedstSpacing`, `AedstShapesScale`), no raw `N.dp` or `RoundedCornerShape(` outside `core/ui` (marker `// allow-dp: reason`) | `scripts/check-ui-tokens.sh` | `TaskCreateScreen.kt` |
| No literal `Text("...")` outside previews (strings in all five locales) | `scripts/check-ui-tokens.sh` | `AedstDatePicker.kt` (`aedst_action_ok`) |
| Every `*Screen.kt` has `@AedstWindowSizePreviews` or `@Preview` | `scripts/check-ui-tokens.sh` | `AdminScreen.kt` |
| `AppRpcContract` equals the RPCs the code calls | `scripts/check-rpc-contract.sh` | `core/network/src/test/.../AppRpcContract.kt` |
| Features never import each other or `core` to `feature`; the app imports only a feature's `navigation` package; Screen/ViewModel/Repository/Module types in features are `internal` | `scripts/check-feature-boundaries.sh` | `feature/tasks` |
| The exported Room schema of the current `@Database` version is committed (`core/database/schemas`) | `scripts/check-room-schemas.sh` (CI step "Room schema JSON exists") | `core/database/schemas/com.aedst.core.database.AppDatabase/1.json` |
| Baseline profile status is reported honestly (none recorded yet) | `scripts/check-baseline-profile.sh` (warning; `AEDST_REQUIRE_BASELINE_PROFILE=1` fails) | n/a |
| Test coverage floor per module | Kover (`org.jetbrains.kotlinx.kover`), `koverVerify` in `android-ci` with a per-module minimum | `core/common` |

## Version catalog allowlist

`apps/android/gradle/libs.versions.toml` may contain only the coordinates and plugin ids listed here
(`scripts/check-catalog-allowlist.sh`). A new dependency is a change to this list in the same PR, with its row in the
stack table above.

- Build and analysis: `com.android.tools.build:gradle`, `org.jetbrains.kotlin:kotlin-gradle-plugin`, `org.jetbrains.kotlin:compose-compiler-gradle-plugin`, `com.google.devtools.ksp:com.google.devtools.ksp.gradle.plugin`, `com.google.dagger:hilt-android-gradle-plugin`, `dev.detekt:detekt-gradle-plugin`, `org.jlleitschuh.gradle:ktlint-gradle`, `io.nlopez.compose.rules:detekt`, `org.jetbrains.kotlinx:kover-gradle-plugin`, `com.android.tools:desugar_jdk_libs`
- Plugins: `com.android.application`, `com.android.library`, `com.android.kotlin.multiplatform.library`, `com.android.test`, `org.jetbrains.kotlin.jvm`, `org.jetbrains.kotlin.multiplatform`, `org.jetbrains.kotlin.plugin.serialization`, `org.jetbrains.kotlin.plugin.compose`, `com.google.devtools.ksp`, `com.google.dagger.hilt.android`, `dev.detekt`, `org.jlleitschuh.gradle.ktlint`, `org.jetbrains.kotlinx.kover`, `com.google.gms.google-services`, `io.sentry.android.gradle`, `com.google.protobuf`, `androidx.baselineprofile`, `io.github.takahirom.roborazzi`, `androidx.room3`
- Kotlin, coroutines, serialization: `org.jetbrains.kotlinx:kotlinx-coroutines-core`, `org.jetbrains.kotlinx:kotlinx-coroutines-android`, `org.jetbrains.kotlinx:kotlinx-coroutines-test`, `org.jetbrains.kotlinx:kotlinx-coroutines-play-services`, `org.jetbrains.kotlinx:kotlinx-serialization-json`, `javax.inject:javax.inject`
- AndroidX core: `androidx.core:core-ktx`, `androidx.core:core-splashscreen`, `androidx.appcompat:appcompat`, `androidx.activity:activity-compose`, `androidx.datastore:datastore`, `androidx.work:work-runtime-ktx`, `androidx.profileinstaller:profileinstaller`
- Compose and navigation: `androidx.compose:compose-bom`, `androidx.compose.ui:ui`, `androidx.compose.ui:ui-graphics`, `androidx.compose.ui:ui-tooling`, `androidx.compose.ui:ui-tooling-preview`, `androidx.compose.material3:material3`, `androidx.compose.material:material-icons-extended`, `androidx.compose.material3:material3-adaptive-navigation-suite`, `androidx.compose.material3.adaptive:adaptive`, `androidx.compose.material3.adaptive:adaptive-layout`, `androidx.compose.material3.adaptive:adaptive-navigation`, `androidx.lifecycle:lifecycle-runtime-compose`, `androidx.lifecycle:lifecycle-viewmodel-compose`, `androidx.lifecycle:lifecycle-viewmodel-navigation3`, `androidx.navigation3:navigation3-runtime`, `androidx.navigation3:navigation3-ui`, `androidx.tv:tv-material`
- DI: `com.google.dagger:hilt-android`, `com.google.dagger:hilt-android-compiler`, `androidx.hilt:hilt-lifecycle-viewmodel-compose`, `androidx.hilt:hilt-work`, `androidx.hilt:hilt-compiler`
- Network and API: `com.connectrpc:connect-kotlin`, `com.connectrpc:connect-kotlin-okhttp`, `com.connectrpc:connect-kotlin-google-javalite-ext`, `com.squareup.okhttp3:okhttp`, `com.squareup.okhttp3:okhttp-coroutines`, `com.squareup.okhttp3:logging-interceptor`, `com.google.protobuf:protobuf-javalite`, `com.google.protobuf:protobuf-kotlin-lite`
- Storage: `androidx.room3:room3-runtime`, `androidx.room3:room3-compiler` (the Room 3 runtime has no separate ktx artifact), `androidx.sqlite:sqlite-bundled` (2.6.2, the `androidx.sqlite` line Room 3.0.3 resolves; resolved from Google Maven 2026-11-21, whether a newer stable exists is UNVERIFIED; used by the `jvm` target of `core/database` in tests only, Android keeps `AndroidSQLiteDriver`)
- Images and media: `io.coil-kt.coil3:coil-compose`, `io.coil-kt.coil3:coil-network-okhttp`, `androidx.media3:media3-common`, `androidx.media3:media3-exoplayer`, `androidx.media3:media3-ui-compose`, `androidx.media3:media3-transformer`, `androidx.media3:media3-effect`
- Auth, security, attestation, push: `net.openid:appauth`, `com.google.crypto.tink:tink-android`, `com.google.android.play:integrity`, `com.google.firebase:firebase-bom`, `com.google.firebase:firebase-messaging`
- Debug tooling: `com.squareup.leakcanary:leakcanary-android` (`debugImplementation` of every application module, from the application convention plugin)
- Telemetry: `io.sentry:sentry-bom`, `io.sentry:sentry-android`, `io.sentry:sentry-okhttp`, `com.posthog:posthog-android`
- Tests: `org.junit:junit-bom`, `org.junit.jupiter:junit-jupiter`, `org.junit.jupiter:junit-jupiter-api`, `org.junit.platform:junit-platform-launcher`, `org.junit.vintage:junit-vintage-engine`, `io.mockk:mockk`, `io.mockk:mockk-android`, `app.cash.turbine:turbine`, `org.robolectric:robolectric`, `androidx.test:core`, `androidx.test:runner`, `androidx.test.ext:junit`, `androidx.test.espresso:espresso-core`, `androidx.compose.ui:ui-test-junit4`, `androidx.compose.ui:ui-test-junit4-accessibility`, `androidx.compose.ui:ui-test-manifest`, `androidx.work:work-testing`, `androidx.room3:room3-testing`, `com.squareup.okhttp3:mockwebserver`, `io.github.takahirom.roborazzi:roborazzi`, `io.github.takahirom.roborazzi:roborazzi-compose`, `io.github.takahirom.roborazzi:roborazzi-junit-rule`, `androidx.benchmark:benchmark-macro-junit4`
