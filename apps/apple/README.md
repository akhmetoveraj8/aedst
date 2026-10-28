# aedst-apple

The AEDST Apple client: one Swift codebase, two platform app targets
(`App_iOS`, `App_macOS`), mirroring the module boundaries of `apps/server`
(see [../../docs/content/apple/architecture.md](../../docs/content/apple/architecture.md),
[../../docs/content/server/architecture.md](../../docs/content/server/architecture.md) and
[../../docs/content/server/modules.md](../../docs/content/server/modules.md) — or the published docs site).

> **This code was written on a Windows machine with no Xcode/Swift toolchain.**
> Nothing in this directory was built, linted, tested or run (CI on `macos-26` with Xcode 26.6 is the first thing that will do so) — every
> `Package.swift`, Tuist manifest, fastlane lane and Swift source file was written by hand
> against the dependencies' published sources/docs (read for
> connect-swift 1.2.3, GRDB 7.x, Nuke 13.2.0 and Tuist's
> `ProjectDescription`; fastlane action parameters were checked against the 2.240.1 source but never run). Open the project on a Mac and run a build before
> trusting it further — see "Getting started" below, and fix anything the
> compiler flags on first build, especially the `NOTE:` comments in
> `Core/AedstNetwork` and each feature's `Connect*RemoteDataSource.swift`.

## Module map

```
Core/AedstCore            Outcome/AedstError, UseCase, AedstClock, AedstLogger, TokenProvider/SessionStore, CapabilitiesService (capability negotiation)
Core/AedstNetwork         connect-swift ProtocolClient factory, AuthInterceptor, error mapping, generated/ (gitignored)
Core/AedstPersistence     Keychain-backed SessionStore, GRDB SQLite database (AedstDatabase + DatabaseMigrator migrations), offline outbox (OutboxRepository/Drainer/SyncCoordinator)
Core/AedstDesignSystem    Colors/typography/spacing tokens + shared SwiftUI components (AedstButton, AedstTextField, AedstErrorPresenter)
Core/AedstNavigation      AedstRoute protocol + Router (@Observable, NavigationPath) + AedstNavigationStack — the feature/api boundary
Core/AedstAnalytics       AnalyticsClient / FeatureFlagProvider / AnalyticsConsent facades + no-op defaults
Core/AedstTelemetry       the only SDK importer: Sentry Cocoa (errors, breadcrumbs, URLSession tracing) + PostHog (consent-gated analytics, flags)
Core/AedstMedia           media kit: Nuke-based remote images (AedstRemoteImage, AedstImagePipeline), AVKit player, thumbnails, ImageIO/AVFoundation compression, PHPicker, background uploader
Core/AedstTesting         ManualClock, StubTokenProvider — shared test doubles

Features/Auth             complete worked example: Domain/Data/Presentation/Navigation
Features/Tasks            task list/detail (complete/reopen/delete), media attachments slot on detail
Features/Search           .searchable + debounced SearchService, U+E000/U+E001 snippet highlighting
Features/Notifications    inbox, unread badge, mark read, preferences, APNs PushCoordinator
Features/Media            library, viewer, TaskAttachmentsView, CreateUpload → presigned PUT → CompleteUpload
Features/Admin            dashboard/users/tasks/broadcast/audit log (entry shown only for the admin role)

App/Shared                AedstAppShared package: AppDependencies (composition root), RootView, AedstAppDelegate (APNs, taps, background uploads), AppLink
App/iOS                   App_iOS Xcode target: @main entry point, Info.plist, Assets.xcassets
App/macOS                 App_macOS Xcode target: @main entry point, entitlements, Info.plist, Assets.xcassets

Project.swift              Tuist project manifest — generates AEDST.xcodeproj (gitignored)
Workspace.swift, Tuist.swift  Tuist workspace / configuration manifests
Tuist/Package.swift        Tuist dependency manifest (integrates the local SwiftPM packages)
Config/                    .xcconfig files (Base/Debug/Release × iOS/macOS)
buf.gen.yaml, Makefile      Connect-Swift codegen from apps/server/api/proto (see Makefile's `generate` target)
Gemfile, fastlane/         fastlane + match (Appfile, Matchfile, Fastfile): signing and release lanes
.swift-format, mise.toml   swift-format config; pinned tuist / SwiftLint / ruby
App/UITests                XCUITest target App_iOS_UITests (accessibility audit)
```

Dependency direction: `Features/*` → `Core/*`, never the reverse; never
`Features/*` → `Features/*` except through `Core/AedstNavigation`'s route
contracts. See
[../../docs/content/apple/architecture.md](../../docs/content/apple/architecture.md) for the
full rule and how it maps to the server's `api/` boundary and to
`apps/android`'s equivalent.

## Getting started (on a Mac)

Requires Xcode 26.6 (the CI baseline; it ships `swift format`; swift-protobuf 1.38 needs Xcode 26 —
SwiftPM picks the newest release your toolchain can build), [Tuist](https://docs.tuist.dev)
(`mise install` in this directory installs tuist, SwiftLint and Ruby from `mise.toml`), Ruby with
bundler for fastlane (`bundle install`; only needed for signing and release), and the [Buf CLI](https://buf.build/docs/installation)
(`brew install bufbuild/buf/buf`) plus `protoc-gen-swift` and
`protoc-gen-connect-swift` on `PATH` if you want real generated Connect
stubs. **Codegen is mandatory**: `Features/Auth` calls the generated `Aedst_Auth_V1_*` types, so run `make generate` before building or testing anything (`make build` / `make test` do it for you).

One command after cloning (the Connect stubs are never committed, so a fresh clone does not compile without it):

```bash
cd apps/apple
make doctor      # optional: lists missing tools (buf, protoc plugins, tuist) with install hints
make bootstrap   # = make generate (Connect stubs) + tuist install + tuist generate --no-open
```

Or step by step:

```bash
make generate   # writes Core/AedstNetwork/.../Generated/*.swift (not committed)
tuist install   # resolves Tuist/Package.swift (local packages + connect-swift, GRDB, Nuke, Sentry, PostHog, swift-snapshot-testing, ...)
tuist generate  # writes AEDST.xcodeproj / AEDST.xcworkspace (gitignored, never commit them) and opens Xcode
```

If you see `cannot find type 'Aedst_..._V1_...' in scope`, the stubs are missing:
`Core/AedstNetwork/Sources/AedstNetwork/GeneratedStubsSentinel.swift` is the one line that
names the fix (`make bootstrap`), and `GeneratedStubsTests` reports a partial or stale
`Generated/` folder with the same instruction.

**After the first successful run on a Mac, commit the lock files** that no one could produce without a Mac:

```sh
cd apps/apple
make bootstrap    # writes Tuist/Package.resolved (tuist install)
make test         # writes Package.resolved in every Core/*, Features/* and App/Shared package
make gem-lock     # writes Gemfile.lock (arm64-darwin, x86_64-darwin, ruby)
git add Tuist/Package.resolved Gemfile.lock Core/*/Package.resolved Features/*/Package.resolved App/Shared/Package.resolved
```

CI cache keys hash the package `Package.resolved`, and `bundler-cache` in the release workflows needs `Gemfile.lock`.
Do not add them to `.gitignore`. Once a `Package.resolved` is committed, `apple-ci` fails when a run changes it (a
dependency moved without a reviewed bump); update it on purpose with `swift package update` in that package.

| Command | What it does |
|---|---|
| `make doctor` | report which of `buf`, `protoc-gen-swift`, `protoc-gen-connect-swift`, `tuist` are missing, with install hints (`generate` and `install` run the relevant subset first) |
| `make check` | `scripts/check-feature-boundaries.sh`, which also runs `check-color-literals.sh` (no color literals outside the generated token files) and `check-file-size.sh` (<=300 green, 301-400 yellow, >400 warning, >500 fails) |
| `make generate` | `buf generate` against `../server/api/proto` → Swift Connect stubs (Connect codegen, not Tuist) |
| `tuist install` / `make install` | resolve Swift package dependencies declared in `Tuist/Package.swift` |
| `tuist generate` / `make project` | generate the Xcode project + workspace from `Project.swift` |
| `make bootstrap` | `generate` + `install` + `project`, in order |
| `tuist build App_iOS` / `App_macOS` (`make tuist-build`) | build an app scheme |
| `tuist test <scheme>` (`make tuist-test`) | run a scheme's tests (`App_iOS` includes the `App_iOS_UITests` accessibility audit) |
| `make build` | `swift build` every local package (not the app targets) |
| `make test` | `swift test` every local package (where the unit tests live) |
| `make format` | swift-format in place (`swift format`, config `.swift-format`) |
| `make format-check` | `swift format lint --strict` (what CI runs) |
| `make lint` | `format-check`, then SwiftLint (semantic rules only) |
| `make signing-sync` | ADMIN, local: `fastlane match_sync` creates/refreshes all certificates and profiles |
| `make beta-ios` | fastlane `ios beta`: match + archive + TestFlight |
| `make release-ios` | fastlane `ios release`: match + archive + App Store Connect (not submitted) |
| `make release-macos` | fastlane `mac developer_id` (notarized, stapled); `DISTRIBUTION=app-store` runs `mac app_store` |

Each package under `Core/` and `Features/` is also a standalone SwiftPM
package — `cd Core/AedstCore && swift test` works without Xcode or
Tuist at all, which is what `.github/workflows/apple-ci.yml` actually
runs in CI (`test` job); the separate `app-build` job generates the Tuist workspace and builds both app schemes unsigned. Releasing (signing, notarization, TestFlight) is in [docs/content/apple/release.md](../../docs/content/apple/release.md).

## Why Tuist instead of a committed `.xcodeproj` (or XcodeGen)

A hand-maintained `.xcodeproj` merges badly (it's an ordered plist keyed by
opaque UUIDs) and drifts silently from the package graph. Tuist replaced
XcodeGen because its manifests are Swift (typed, refactorable, shared helper
functions — see `makeAppTarget` in `Project.swift`), it resolves and
integrates Swift packages itself (`Tuist/Package.swift`), and it is the one
tool that also covers build/test/cache commands. `Project.swift` is the single
source of truth for targets/schemes/deployment targets — regenerate with
`tuist generate` after adding a source folder or changing a build setting,
same spirit as `apps/android`'s `settings.gradle.kts` being hand-authored
while the Gradle-generated IDE project model isn't committed.

Tuist integrates the local packages as generated (static-framework) targets
rather than as Xcode-native local packages; the `Tuist/Package.swift` route was
chosen so third-party versions stay declared once, in the packages themselves.
If a package quirk shows up on first generate (resource bundles in
`Features/Auth`, Swift 6 language mode per target), the
fallback is Xcode-native integration: declare `packages: [.package(path: "App/Shared")]`
in `Project.swift` and `.package(product: "AedstAppShared")` as the target
dependency, and drop `Tuist/Package.swift`.

## Minimum OS versions

Floor: **iOS / iPadOS 18.0, macOS 15.0**. The single source is `Project.swift`
(`iOSDeploymentTarget`, `macOSDeploymentTarget`); every `Package.swift`
`platforms:` entry must not exceed it. Nothing below the floor is supported, so
nothing is `#available`-gated or backported for older systems.

| Platform | Floor | Where declared | Reasoning |
|---|---|---|---|
| iOS / iPadOS | **18.0** | `Project.swift`, every `Package.swift` | In October 2026 the current iOS is 26; the iOS 15/16 share is small, and supporting them forced workarounds (an Observation backport, a `NavigationStack` backport, `#available` gates, no `Duration`). |
| macOS | **15.0** | `Project.swift`, every `Package.swift` | Same reasoning; also equals the minimum of `grpc-swift-2` (see Networking). |
| tvOS | 18.0 (packages only) | Core packages | Scaffold: no app target. Follows iOS. |
| watchOS | 11.0 (packages only) | Core packages | Scaffold: no app target. |
| visionOS | 2.0 (packages only) | Core packages | Scaffold: no app target. |

No audience analytics existed to base the floor on (the app is unreleased), so
the floor is a judgement call to revisit with real analytics. The owner may
lower it to **iOS 17 / macOS 14** by changing the two constants in `Project.swift`
(and the matching `platforms:`): Observation, `NavigationStack` and
`performAccessibilityAudit` all work at 17, so nothing has to be re-added.

Dependency minimums (not re-verified against the tagged `Package.swift` files after the floor change; all are far below the floor):

| Dependency | Version used | Notes |
|---|---|---|
| connect-swift | 1.2.3 (latest release) | generated async methods back-deploy far below the floor |
| swift-protobuf | >= 1.31.0 (latest 1.39.0, tools 6.2) | connect-swift 1.2.3 requires >= 1.31.0 |
| GRDB.swift | >= 7.0.0 (latest 7.11.1, tools 6.1) | |
| Nuke / NukeUI | 13.2.0 | used only through `Core/AedstMedia`; ships no `PrivacyInfo.xcprivacy` |
| swift-snapshot-testing | >= 1.19.7 | test dependency of `Core/AedstDesignSystem` only |

Platform replacements for removed libraries: `@Observable` / `@Bindable` /
`@ObservationIgnored` replace swift-perception, and `NavigationStack` +
`NavigationPath` replace FlowStacks (`Router`, `AedstNavigationStack` and
`aedstDestination` keep their API). `Environment(_: Observable)` and
`Duration` / `Task.sleep(for:)` are allowed; `AedstClock` still uses
nanoseconds on purpose and its protocol stays `TimeInterval`-based.

## Persistence: GRDB (replaces SwiftData)

`Core/AedstPersistence` provides `AedstDatabase`: a GRDB `DatabasePool`
(on-disk, WAL, concurrent readers + serialized writer) or `DatabaseQueue`
(in-memory, tests), migrated through `DatabaseMigrator`. Base migrations live in
`AedstBaseMigrations`; each feature adds its own via a
`registerMigrations(in: &migrator)` function passed to `AedstDatabase.openPool(at:registering:)`
from the composition root. Access is `try await pool.read/write { db in ... }` —
`DatabaseWriter` is `Sendable`, so no extra actor is needed. Tokens stay in the
Keychain (`KeychainTokenStore`), never in SQLite.

Today the database holds key-value data, preferences and the offline write queue
(`aedstOutbox`, drained by `OutboxDrainer`; see [../../docs/content/apple/offline.md](../../docs/content/apple/offline.md));
no list in the app is driven by it (all lists come from the network).

Decision (GRDB vs SQLiteData vs SwiftData):

- **GRDB directly** is used now: plain SQL/records, first-class `DatabaseMigrator`
  with explicit versioned migrations, concurrency-safe pool.
- **SwiftData** is not used: GRDB gives explicit versioned migrations and control
  (the reason is control, no longer OS reach — iOS 17 is below the floor).
- **SQLiteData** (Point-Free, built on GRDB; latest 1.12.0, verified 2026-10-08) is the
  **approved choice for reactive queries in views** once the first DB-driven view appears;
  GRDBQuery 0.11.0 is the lighter alternative. It is **not added yet** because no view needs
  `ValueObservation` (library-first: no dependency without a use). Trigger: the first
  offline-first list/screen (the Apple equivalent of Android's Room outbox/sync). It sits on
  a GRDB `DatabasePool`, so adopting it does not invalidate this layer.

## Dependency injection

Dependencies are assembled by explicit constructor injection with one composition
root (`AppDependencies` in `App/Shared`), protocols at the layer seams and
`make*ViewModel` factories. Every external effect (Keychain, connectivity,
biometrics, clock, telemetry, OIDC, web authenticator, launch mode) is an `init`
parameter with a production default; tests pass doubles. swift-dependencies
(Point-Free) was suggested by the owner and evaluated but **not adopted now**:
verified 2026-10-08 (`git ls-remote` + raw `Package.swift`), its latest tag 1.17.1
declares swift-tools-version 6.4, which Xcode 26.6 cannot parse (the same blocker
that removed the swift-perception pin); 1.17.0 (tools 6.1) would need a version cap.
Revisit when an Xcode with Swift 6.4 is the CI default (then `@Dependency` for ambient
seams such as clock, analytics, UUID/date); adopting it later is a contained change.
See [decisions](../../docs/content/decisions.md).

## Sign-in (OIDC) and session

Browser sign-in uses platform APIs only (AuthenticationServices, CryptoKit, `URLSession`):
`ASWebAuthenticationSession` with Authorization Code + PKCE (S256).
`OIDCAuthRepository`, `SignInMode` (`.password` | `.browser`) and `SignInUseCase`
implement it. The ID token is fully verified (`IDTokenVerifier`, no new dependency): the JWS
signature against the keys at discovery's `jwks_uri` (`OIDCKeySet`: cached 1 h, one throttled
refetch on an unknown `kid`, single-flight; no `jwks_uri` = sign-in fails closed), with an
allow-list of RS256 / ES256 / EdDSA (`none`, `HS*` and key-type/algorithm mismatches are
rejected), then `iss`, `aud`, `azp`, `exp`/`iat` (60 s skew), `nonce` and `at_hash`; `state`,
`nonce` and `at_hash` compare in constant time. Refresh is the
`refresh_token` grant with **no retry** (rotation and reuse detection) and is single-flight
in `KeychainTokenStore` (a refresh that finishes after sign-out or a new sign-in is discarded):
`invalid_grant`
ends the session, any other failure keeps it; the refresh lifetime is estimated by
`AEDST_OIDC_REFRESH_TTL_DAYS`. Logout is an RFC 7009 revocation (best effort) plus a local
clear; the IdP's own browser session is not ended (`end_session` would need a second system sheet). A token response
without an `id_token` is refused (the nonce check binds the response to our request). Set
`AEDST_OIDC_EPHEMERAL_SESSION = YES` to sign in inside a private browser session so nothing outlives sign-out, at the
cost of SSO and saved passkeys (decisions/apple.md, "OIDC browser session"). The redirect is the custom scheme
`com.aedst.apple:/oauth2redirect` (iOS 17.4+ `.https` callbacks are a hardening follow-up
that needs an apple-app-site-association file). AppAuth-iOS was considered and not adopted
(the platform API suffices; revisit for DPoP/PAR/multi-IdP quirks).

It is **off by default**: an empty `AEDST_OIDC_ISSUER` keeps the first-party
email/password path until `AEDST_AUTH_FIRST_PARTY_SUNSET`.

| Build setting | Meaning |
|---|---|
| `AEDST_OIDC_ISSUER` | issuer URL; empty = OIDC off |
| `AEDST_OIDC_CLIENT_ID` | client id of the ZITADEL native app |
| `AEDST_OIDC_SCOPES` | default `openid profile email offline_access` |
| `AEDST_OIDC_AUDIENCE_SCOPE` | ZITADEL audience scope, `urn:zitadel:iam:org:project:id:<projectId>:aud` |
| `AEDST_OIDC_REDIRECT_SCHEME` | default `com.aedst.apple` (redirect `com.aedst.apple:/oauth2redirect`) |
| `AEDST_OIDC_REFRESH_TTL_DAYS` | estimated refresh-token lifetime, default 30 |
| `AEDST_OIDC_EPHEMERAL_SESSION` | `YES` = private browser session for sign-in (no SSO, nothing left at the IdP), default `NO` |
| `AEDST_OIDC_WEBCREDENTIALS_DOMAIN` | Associated Domains `webcredentials:` host; placeholder `idp.example.invalid` |

ZITADEL application settings: Native app; auth method None (PKCE); grant types
Authorization Code + Refresh Token; redirect URI exactly `com.aedst.apple:/oauth2redirect`;
access token type JWT; role assertion on; audience scope via `AEDST_OIDC_AUDIENCE_SCOPE`;
`offline_access` allowed; passkeys enabled in the login policy.

**Passkeys** are provided by ZITADEL's hosted login inside the browser session. The app does
**not** call `ASAuthorizationPlatformPublicKeyCredentialProvider` (that would be a
self-built identity feature); revisit if a fully native login UI is wanted (ZITADEL Session API).

**Keychain**: tokens and secrets use `kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly` with
`kSecAttrSynchronizable = false` (no iCloud sync, no backup or migration to another device);
existing items migrate on the next write.

**App Attest (DeviceCheck)**: `AppAttestService` (key + attestation, `Core/AedstNetwork/.../DeviceAttestation.swift`)
driven by `AttestationCoordinator` over the server's `AppAttestService` RPCs (`CreateChallenge`, `Enroll`,
`VerifyAssertion`; `ConnectAppAttestRemote`). After sign-in `AppDependencies` starts a detached, best-effort
enrollment (iOS/iPadOS on a supported device only; one attempt per launch/sign-in; never blocks or errors the UI);
the key is discarded on sign-out because the server binds it to the user. `assert(action:payload:)` exists but no
user flow calls it and the server enforces nothing yet. **Statically reviewed, not compiled or run on a device.**
The key id is a device identifier sent to our server for fraud prevention (declared as `DeviceID`, App Functionality,
in `PrivacyInfo.xcprivacy`). See [ADR-0016](../../docs/content/decisions/0016-device-attestation.md).

## Testing

- **Unit tests**: Swift Testing, per package (`make test`).
- **UI tests**: XCUITest only, in `App/UITests` (target `App_iOS_UITests`);
  `performAccessibilityAudit()` runs on the start and login screens. A DEBUG-only launch
  argument `-aedst-ui-testing` selects `AppLaunchMode.uiTesting`: in-memory secure store,
  telemetry off, OIDC bundle config ignored. **Known gap**: no UI audit of the task list after
  a stubbed sign-in (it needs a repository seam).
- **Snapshots**: swift-snapshot-testing >= 1.19.7, a test dependency of
  `Core/AedstDesignSystem` only. iOS Simulator: **36 reference images** (6 component groups x 6 variants: iPhone
  light, dark, accessibility XXXL, RTL and iPad light, dark); macOS: **18** (6 x 3: light, dark, RTL). **None is
  recorded yet**: run `make snapshots-record` (or the manual `apple-record-snapshots` workflow), which records both
  platforms, verifies them and writes `ENVIRONMENT.txt`, then commit the `__Snapshots__` directories
  ([snapshots](../../docs/content/apple/snapshots.md)). There is no pixel snapshot of the app-level screens
  (`HomeView`, the split layout): the pipeline is design-system only, and `RootLayoutTests` pins the layout rule.
- **Contract test**: `Core/AedstNetwork/Tests/AedstNetworkTests/ProtoContractTests.swift`
  compares the services and RPCs in `apps/server/api/proto` with the generated connect-swift
  client metadata and the app's used-procedure table, and has a golden test for the
  `Connect.Code` -> `AedstError` mapping (like web's mock-api contract test and desktop's
  `methods_test.cpp`).
- **Format and lint**: swift-format (ships with the Xcode 26 toolchain, config `.swift-format`)
  formats; SwiftLint 0.65.1 runs semantic rules only (rules overlapping formatting are disabled).
  `make format`, `make format-check`, and a CI step. SwiftFormat (nicklockwood) and Periphery
  are not used.

None of this has been run: the first Xcode build is the acceptance test.

## Networking: connect-swift 1.2.3 (Plan B: grpc-swift-2)

connect-swift **1.2.3** (released 2026-05-21) is the latest release (checked on GitHub releases; it
matches the requested version). It is the 1.x stable line (API stable since 1.0). The previously
written `AuthInterceptor` targeted a `UnaryFunction`/`StreamFunction` API that does not exist in any
release; it now implements `UnaryInterceptor` (`handleUnaryRequest` / `handleUnaryResponse`), the
client config uses `ProtoCodec()` and `InterceptorFactory`, and `Code.name` replaces the non-existent
`Code.description` in `NetworkErrorMapping`.

**Plan B** if connect-swift stalls:
[`grpc-swift-2`](https://github.com/grpc/grpc-swift-2) + `grpc-swift-protobuf` +
`grpc-swift-nio-transport` (gRPC over HTTP/2 or gRPC-Web is served by the Connect server too) with
`swift-protobuf` codegen (`protoc-gen-grpc-swift-2`). Its availability is macOS 15 / iOS 18 / watchOS 11 /
tvOS 18 / visionOS 2 with swift-tools 6.1, so it is **no longer blocked by the OS floor** (the floor now
equals its minimum) and is a possible option. connect-swift stays for the remaining reasons: the
generated Connect client and the owner's decision. It would also need a gRPC-capable transport (NIO)
rather than `URLSession`. Only `Core/AedstNetwork` (and each feature's `Connect*RemoteDataSource`) would
change; `Features/*` depend on their own `*RemoteDataSource` protocols, not on generated types.

## Telemetry, push and media configuration

| Build setting / Info.plist key | Where it comes from | Effect when empty |
|---|---|---|
| `AEDST_SENTRY_DSN` | `Config/Secrets.local.xcconfig` (copy the `.example`) or `xcodebuild AEDST_SENTRY_DSN=...` | Sentry off |
| `AEDST_POSTHOG_KEY`, `AEDST_POSTHOG_HOST` | same | PostHog off, feature flags return their defaults |
| `AEDST_POSTHOG_SESSION_REPLAY` | `Config/Base.xcconfig` (default `NO`) | replay off |
| `AEDST_ROLES_CLAIM` | `Config/Base.xcconfig` (`roles`; ZITADEL: `urn:zitadel:iam:org:project:roles`; Keycloak: `realm_access.roles`) | defaults to `roles` |
| `AEDST_APNS_SANDBOX` / `APS_ENVIRONMENT` | `Config/Debug.xcconfig` (YES/development), `Config/Release.xcconfig` (NO/production) | — |

- **Errors**: Sentry is operational (no consent), user id only, no screenshots/view hierarchy/replay. Release name
  `<bundle id>@<version>+<build>`; `scripts/upload-dsyms.sh` uploads dSYMs (CI on main, and the release workflow).
- **Product analytics**: PostHog starts opted out; the "Share anonymous usage analytics" toggle opts in. PostHog's
  push/screen swizzling and crash capture are disabled (Sentry owns crashes; the app owns push).
- **Session replay**: PostHog is the single replay tool on iOS (Sentry replay is not used). It is
  off by default (`AEDST_POSTHOG_SESSION_REPLAY = NO`), iOS only, screenshot mode, has network telemetry
  capture off, and stops when consent is denied. Masking is deny-by-default: in posthog-ios 3.90.2
  `maskAllTextInputs` (there is no separate "all text" option) also covers SwiftUI `Text`/`Button`/`TextEditor`
  and `UILabel`, alongside `maskAllImages` and `maskAllSandboxedViews`; the flags live in
  `ReplayConfiguration` (unit-tested). As defence in depth, views that show personal or user-generated data
  (task titles/details, search hits, notification rows, media, admin lists, login fields) carry
  `.aedstSensitive()` (`AedstDesignSystem`), an explicit PostHog mask region that does not rely on
  recognising SwiftUI's private classes and also covers video frames. Features never import PostHog:
  `AppDependencies` injects `ReplayMasking` through `EnvironmentValues.aedstSensitiveContent` (identity when
  replay is off). New screens that render user data must add `.aedstSensitive()`; there is deliberately no
  `postHogNoMask()` allow-list. **UNVERIFIED**: nothing was compiled or recorded; check a real replay
  (including iOS 26) before enabling it in production.
- **Push**: the App ID needs the Push Notifications capability. The server must send the in-app route as a top-level
  `link` key next to `aps` in the APNs payload; taps route through `AppLink`.
- **Uploads** use a background `URLSession` (`com.aedst.apple.media-upload`); bytes go straight to object storage.
- **Images**: Nuke (`Nuke`, `NukeUI`) only through `Core/AedstMedia` (`AedstRemoteImage`, `AedstImagePipeline`):
  disk `DataCache` 150 MB plus a dedicated 64 MB memory cache, thumbnail downsampling; presigned/imgproxy URLs are sent
  **unmodified** (no bearer or tracing headers); `AedstImagePipeline.removeAll()` runs on sign-out. The hand-written
  `RemoteImageLoader` was deleted, `AsyncImage` is not used for lists, and prefetch is not implemented (plain
  `LazyVGrid`). `ImageDownsampler` / ImageIO stays for the local picker and compression. Nuke ships no `PrivacyInfo.xcprivacy`; a static audit of its
  13.2.0 sources found only file-timestamp use (`contentAccessDate` in `DataCache`), so both app manifests declare
  `C617.1`; run Xcode's *Generate Privacy Report* to confirm.
- **Renovate** is the only dependency updater (repo-root `renovate.json`: swift, bundler for `Gemfile`, mise,
  github-actions); there are no version caps besides the swift-protobuf floor. A package whose newest tag needs a newer
  swift-tools-version than the CI Xcode gets an explicit cap plus a [decisions](../../docs/content/decisions.md) entry.
