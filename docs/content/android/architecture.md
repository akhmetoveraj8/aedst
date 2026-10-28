---
title: "Android Architecture"
description: "apps/android mirrors the same \"monolith first, boundaries first\" philosophy as the backend (see architecture.md and modules.md), translated to a..."
---

# Android Architecture

`apps/android` mirrors the same "monolith first, boundaries first" philosophy
as the backend (see [architecture.md](/server/architecture) and
[modules.md](/server/modules)), translated to a multi-module Gradle project. This
doc only covers where the two diverge and how they map onto each other —
read the two linked docs first.

## Module map

| Server module (`apps/server/internal/modules/`) | Android module (`apps/android/`) | Status |
|---|---|---|
| `auth` | `feature/auth` | complete worked example (domain/data/presentation/navigation) |
| `tasks` | `feature/tasks` | reference module with offline outbox and sync; the template for new feature modules next to `feature/auth` |
| `internal/shared`, `internal/platform` | `core/common`, `core/network`, `core/database`, `core/outbox`, `core/datastore`, `core/security`, `core/analytics`, `core/capabilities`, `core/media` | cross-cutting, no feature imports these back |
| a module's `api/` package | `core/navigation`'s `AedstKey`/`AedstNavGraph`/`AedstNavigator` | the only surface another feature or `app/` may depend on |

## The boundary rule, translated

Server rule (ADR-0006): only a module's `api/` package may be imported across
module boundaries; `domain`/`application`/`infrastructure`/`transport` never
leak out.

Android equivalent, enforced by Gradle module graph rather than a static
analyzer (see "Scope cut" below):

- `feature/*` depends on `core/*`. Never the reverse.
- `feature/*` never depends on another `feature/*` module's Gradle target.
  Cross-feature navigation goes through `core/navigation`: the typed
  Navigation 3 keys in `AedstKey` (`TaskDetailKey(taskId)`,
  `MediaDetailKey(mediaId)`, ...), the `AedstNavGraph` contract (each feature
  registers `entry<Key>` content on a shared `EntryProviderScope<NavKey>`) and
  the `AedstNavigator` handle (`navigate`, `back`, `replaceTop`,
  `completeSignIn`) — a feature navigates to a key another feature happens to
  register, the same way a server module calls another module's stable RPC
  contract instead of importing its handler package. Server in-app links
  (`/tasks/<id>`) are validated and mapped to keys by `AedstRoutes.keyForLink`.
- `app/` is the only module allowed to see every feature — it composes their
  `navigation` entry points into one `NavHost` ([AppNavHost.kt](../../../apps/android/app/src/main/kotlin/com/aedst/android/navigation/AppNavHost.kt)),
  exactly like `cmd/server` wires every module's transport handlers.
- **Navigation 3** (`androidx.navigation3`): the back stack is app-owned state,
  a list of `@Serializable` `NavKey`s saved by `rememberNavBackStack` — one
  stack per tab plus the signed-out login stack (`AedstTabNavigator`, plain
  Kotlin and unit-tested). `NavDisplay` renders the entries inside a
  `NavigationSuiteScaffold` (bottom bar on phones, rail on tablets). Entry
  decorators scope `rememberSaveable` state and ViewModels per back stack
  entry, so a ViewModel that needs its key (task/media id) gets it through Hilt
  assisted injection (`@HiltViewModel(assistedFactory = ...)` +
  `hiltViewModel(creationCallback = ...)`) instead of `SavedStateHandle`.
  Sign-out resets every stack; `NavigationTelemetry` reports the top key's
  template name (never ids) to PostHog and as a Sentry breadcrumb.
- Inside a feature, layering is one-directional: `presentation -> domain`,
  `data -> domain` (implements its repository interfaces), never
  `domain -> data`. See `feature/auth` for the fully worked layout.

## Boundary enforcement: `check-feature-boundaries.sh`

The server enforces its boundary rules with a static analyzer that fails CI
(ADR-0006). Android's equivalent is
[`scripts/check-feature-boundaries.sh`](../../../apps/android/scripts/check-feature-boundaries.sh),
wired into `android-ci.yml`'s `lint` job: it greps every `feature/*/build.gradle.kts`
for a `project(":feature:...")` reference to another feature module and fails
the build if it finds one. It's a grep-based check, not a Gradle plugin or a
`detekt` custom rule, deliberately — it needed no new build-logic dependency
and catches the one mistake this rule actually guards against (a feature
declaring a Gradle dependency on another feature). Revisit if the module
graph outgrows what a per-file grep can express.

See [modules.md](/server/modules) for the global module set (`auth`, `tasks`,
`search`, `notifications`, `media`, `admin`). Each has a `feature/<name>`
module following the same four-layer shape as `feature/auth`; a product built
on the template adds its own domain modules the same way.

## Phone and TV: a second thin app target

Android now mirrors the pattern [architecture-apple.md](/apple/architecture)
already documents for iOS/macOS: two **thin** platform app modules sharing
100% of business logic and non-diverging UI through the same `core/*` /
`feature/*` module graph, rather than a forked app.

- **`:app`** — phone/tablet, unchanged structurally (`MainActivity`,
  `AedstApplication`, `AppNavHost`).
- **`:app-tv`** (`apps/android/app-tv/`) — Android TV, its own
  `AndroidManifest.xml` (`android.software.leanback` required,
  `LEANBACK_LAUNCHER` instead of `LAUNCHER`), its own minimal
  `MainTvActivity`/`AedstTvApplication` entry point, wiring the same `AuthNavGraph` from `:feature:auth`
  (`useDeviceFlow = true`, and an `actionButton` slot that swaps the touch `AedstButton` for `TvPrimaryButton`,
  because `feature/auth` must not depend on TV widgets) — zero business-logic duplication,
  the same way `App_iOS`/`App_macOS` both link one `AedstAppShared` package.
- **`:core:ui`** stays the shared design system both targets can use for
  anything that doesn't need to diverge (theme tokens, non-focus-sensitive
  pieces).
- **`:core:ui-tv`** (`apps/android/core/ui-tv/`) — a thin module, *not* a
  fork of `:core:ui`, used only by `:app-tv`. Depends on `:core:ui` (`api`,
  for token/theme reuse) and `androidx.tv:tv-material` (official Jetpack
  Compose for TV library — approved via library-first.md's "Platform API"
  tier). Holds only the handful of `Tv*`-prefixed components that genuinely
  need to differ for 10-foot/D-pad UI (`TvPrimaryButton`, `TvTopAppBar`, `TvUpgradeRequiredScreen`; lists use
  standard Compose `LazyRow`/`LazyColumn`, because `tv-foundation` is deprecated) — this module boundary does the same job
  Apple's `#if os(iOS)`/`#if os(macOS)` branches do inside one shared
  SwiftUI package, just expressed as a Gradle module split instead of a
  compile-time directive, since Kotlin/JVM has no OS-conditional-compilation
  equivalent.

```
:app        -> :core:common, :core:ui, :core:navigation, :core:analytics, :core:security, :core:network,
               :core:capabilities, :core:database, :core:outbox, :core:media, every :feature:*
:app-tv     -> :core:common, :core:ui-tv, :core:navigation, :core:analytics, :core:security,
               :core:capabilities, :feature:auth
:core:ui-tv -> :core:ui (api), androidx.tv:tv-material (api)
```

See [`apps/android/core/ui-tv/README.md`](../../../apps/android/core/ui-tv/README.md)
for the component-level detail. The TV app builds and its JVM tests pass (see [status](/status)); it has never run on a TV device or emulator.

## Toolchain, networking and secrets (current decisions)

Full rationale and revisit conditions: [decisions](/decisions); stack table:
[library-first](/library-first#android).

- **JDK 21 required** (project toolchain pin). Run `make generate` (buf)
  before the first build; generated stubs are not committed. Versions are
  latest-stable only, with the Compose BOM applied through `platform()`.
- **DI: Hilt on AGP 9** with built-in Kotlin (no explicit `kotlin-android`
  plugin). Metro only if KMP appears; Koin was rejected (no compile-time checks).
- **Networking: connect-kotlin 0.10.0 over OkHttp 5.5.1** (compileSdk 37); no
  Retrofit. Plan B if connect-kotlin stalls: Wire / gRPC-Kotlin (the server also
  serves gRPC and gRPC-Web).
- **Secrets: Android Keystore + Tink AEAD** (`AndroidKeysetManager`) with an
  encrypted DataStore serializer. `androidx.security:security-crypto`
  (`EncryptedSharedPreferences`) is deprecated and no longer used; legacy data is
  migrated read, write, delete.

## Session, offline and client protection (current decisions)

Rationale and revisit conditions: [ADR-0013](/decisions/0013-android-offline-and-client-security).

```
request ──► RequestHeadersInterceptor (X-Aedst-Client, traceparent)
        ──► AuthInterceptor (Bearer from AuthTokenStore)
        ──► server ── 401 ──► TokenRefreshAuthenticator ──► TokenRefresher (feature/auth: mutex, OIDC refresh grant)
                                                          ├─ ok        → replay once with the new token
                                                          ├─ rejected  → session cleared → SessionState=false → app/ routes to login
                                                          └─ transient → IOException (retryable network error), session kept
```

- **Sign-in is OIDC.** The app signs in with Authorization Code + PKCE in a Custom Tab on the IdP's hosted login (AppAuth-Android) and has no credential form or first-party login RPC. The refresh token never leaves the Tink-encrypted store; a refresh is the OIDC `refresh_token` grant at the IdP token endpoint (AppAuth), single-flight behind a mutex because ZITADEL rotates refresh tokens. `invalid_grant` clears the session; offline/5xx keep it. Registration: `apps/server/deployments/zitadel/android-app.md`.
- **Who owns what.** `core/network` declares the contracts (`AuthTokenProvider`, `TokenRefresher`); `feature/auth` implements them in `AuthModule`; `core/common` declares `SessionState`, which `app/` reads. `app/` never imports `feature/auth`'s domain or data packages.
- **Offline writes.** A feature persists an `OutboxEntity` through `OutboxRepository.enqueue(type, payload, id)` and registers one `OutboxHandler` per type (`@Binds @IntoSet`). `OutboxSyncWorker` delivers in creation order when the network is connected, with exponential backoff; the row id is the `Idempotency-Key`. Retryable errors (`Unavailable`, `Offline`, `Timeout`, `RateLimited`) keep the item; anything else parks it as `FAILED`. `feature/tasks` is the reference: `TaskCreateOutboxHandler` (`task.create`), `TaskCompleteOutboxHandler` (`task.complete`) and `TaskUpdateOutboxHandler` (`task.update`, no producer yet) decode the queued request message (protobuf wire format in Base64) and call the generated client with `idempotencyHeaders(item.id)`. `CreateTaskUseCase` / `CompleteTaskUseCase` are online-first: they call the server at once under a fresh operation id and queue **the same id** when the device is offline (`NetworkMonitor`) or the call failed retryably. Every direct write (`ConnectTaskRepository`, `ConnectMediaRepository.createUpload`) sends a fresh `Idempotency-Key` per call too, because OkHttp's `retryOnConnectionFailure(true)` re-sends a POST. Parked items raise `OutboxFailedAlert` (retry / discard) under the offline banner and are deleted after 30 days. The queue, the Coil caches, in-flight uploads and the unread badge are wiped when the session ends (`SignOutHook.onSessionEnded`, on sign-out and on a rejected refresh token).
- **Errors reach users as kinds, not text.** ViewModels put an `AedstError` in state; the composable calls `error.userMessage()` (`core/ui`), which maps the kind to a localized string.
- **Forced upgrade.** `core/network`'s `ClientUpgradeInterceptor` (connect-kotlin interceptor) reads the `google.rpc.ErrorInfo` detail of a `failed_precondition` answer; reason `CLIENT_UPGRADE_REQUIRED` latches `ClientUpgradeState` (`core/common`), `app/`'s `MainActivity` then renders only `UpgradeRequiredScreen` (`core/ui`: localized, `market://` link with an https fallback). `toAedstError()` maps the same error to `AedstError.UpgradeRequired` (never retryable, message not shown or logged). Replay tests: `ClientVersionGateReplayTest`, `SessionRefreshReplayTest`, `OutboxFixtureReplayTest` read `docs/contract/behavior/*.json` directly (Gradle test-resources srcDir, no copies).
- **Data classes and where they live.** Secrets → `core/security` (Keystore + Tink). Non-sensitive, re-fetchable data and the outbox → Room (unencrypted). Preferences → DataStore. Nothing is backed up (`allowBackup=false`; `data_extraction_rules.xml` excludes every domain from cloud backup and device transfer in both apps).
- **Capability negotiation** (ADR-0009, fixture `docs/contract/behavior/capabilities.json`). `core/capabilities` calls the public `CapabilitiesService.GetCapabilities` (connect-kotlin stub from `make generate`) on start-up and every `ON_START` (skipped for 5 minutes after a success) and keeps the last answer as serialized proto bytes in `UserPrefs.capabilities_snapshot`; the cache is the single source of truth, so "failure -> last known -> defaults" needs no special case. `CapabilityResolver` is the pure rule set: shown iff built (`ClientBuild.features`) AND server-enabled; a built feature the server does not list keeps its default (built-ins on, `flagged` such as `admin` off); `Feature.required_client_version` hides it on older builds; unknown server names are never looked at. `core/common` exposes it as `CapabilitiesState` (`FeatureAvailability`); `app/` turns it into `AedstTabNavigator.setEnabledTabs` (a disabled tab disappears, the start tab moves, the account tab is always kept) and drops `AedstRoutes.featureForRoute` deep links into a disabled feature. A fresh answer whose platform `minimum` is above this build latches `ClientUpgradeGate` (same forced-upgrade screen); `recommended` / `UPDATE_STATUS_RECOMMENDED` shows the dismissible `UpdateRecommendedBanner`. `app-tv/` shows the D-pad friendly `TvUpgradeRequiredScreen` (`core/ui-tv`) from the same latch. The RPC carries the bearer token if one exists (the server ignores it).
- **Release gate.** `preReleaseBuild` of **every application module** (`:app`, `:app-tv`, wired once in `AndroidApplicationConventionPlugin`) depends on `:core:network:verifyReleaseCertPins`; pass `-Paedst.certPins=sha256/<live>,sha256/<backup>` (or, deliberately, `-Paedst.allowUnpinnedRelease=true`).
- **Tests.** JVM (`testDebugUnitTest`): JUnit, MockK, Turbine, MockWebServer, and Robolectric for Compose, Room and Worker tests. Instrumented (`connectedDebugAndroidTest`): Compose UI tests with Accessibility Test Framework checks enabled (`enableAccessibilityChecks()`), run on an emulator in CI.

## ViewModel contract

Every screen's ViewModel has the same shape. References: `feature/tasks` (`TaskCreateViewModel`,
`TaskDetailViewModel`, `TaskListViewModel`).

- **State.** One immutable `data class XState`. The ViewModel owns a private `MutableStateFlow` and exposes it only as
  `val state: StateFlow<XState>` (`asStateFlow()`); the mutable flow never leaves the class. The Route collects it with
  `collectAsStateWithLifecycle` and hands plain values to a stateless `XScreen`.
- **Intent.** A `sealed interface XIntent` handled by a single `fun onIntent(intent: XIntent)`. The screen receives
  `onIntent`, not a bag of per-event functions.
- **Effect.** One-shot events (navigate, open the browser) are a `sealed interface XEffect` sent through
  `Channel<XEffect>(Channel.BUFFERED)` and exposed as `effects: Flow<XEffect>` via `receiveAsFlow()`. A channel, not a
  `StateFlow`, so an effect is neither replayed after rotation nor lost while nothing collects.
- **Errors.** A transient error is `error: AedstError?` in the state, shown once by `AedstErrorSnackbarEffect`, which sends
  `XIntent.ErrorShown`; a reload-style screen passes `onRetry` so a retryable kind carries a "Retry" action. Errors that
  belong to a field (title too long) are separate state flags.
- **Loading.** One `Job` per operation (`refreshJob`, `loadMoreJob`, `loadJob`): a newer request cancels the older, and
  `ensureActive()` follows the repository call, so a superseded answer is never applied (a repository that finished
  anyway cannot overwrite a newer page). Jobs are declared before `init`, which may start one.
- **Saved state.** Input worth keeping across process death (the create-form draft, the search query) lives in
  `SavedStateHandle`. Ids from a navigation key still arrive by assisted injection (`@HiltViewModel(assistedFactory)`),
  not through the handle.
- **Streams that are not user intent** (WorkManager upload progress, the session) may be extra read-only `StateFlow`s.

## Media variants

Presets (ADR-0015): `thumb_64` tiny lists, `avatar_256` avatars and small square tiles,
`card_400` grids and cards (the only uncropped preset), `feed_800x600` feeds,
`story_1080x1350` stories. The server returns them as signed imgproxy URLs under
`VariantKind` 5-9 (plus a stored `POSTER` for video); the legacy kinds 1-3 are
`reserved` and gone.
`core/media` maps them to `MediaItem.presetUrls: Map<ImagePreset, String>`;
`MediaItem.imageUrl(preset)` returns the preset, else the nearest one, else the
poster, else the original image. `MediaThumbnail(preset = ...)` picks per screen
(library grid `CARD_400`, task attachments `AVATAR_256`); `displayUrl` (detail
view, playback) is the original. Verified on the JVM only (unit tests, assemble); image
rendering has not been looked at on a device.
