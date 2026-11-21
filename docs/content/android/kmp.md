---
title: Kotlin Multiplatform structure
description: "What is common code on Android today, which targets it compiles for, what each remaining step needs, and how a team adds an iOS target."
---

# Kotlin Multiplatform structure

Owner decision, 2026-11-21 ([decisions/android](/decisions/android), [status](/status)): the Android client is
structured as Kotlin Multiplatform **without an iOS target**. Apple stays native SwiftUI in this template. The point of
the structure is that a team that does not want the native Apple app can add iOS targets later without first untangling
Android and JVM types from the business logic.

Targets today: `android` and `jvm`. Nothing here was run on a device; see "What was compiled".

## Module graph

```text
app, app-tv                      Android applications (Compose, Hilt, navigation)
  feature/<name>                 Android library: data, presentation, navigation, Hilt module
    feature/<name>/domain        KMP (commonMain): entities, repository ports, use cases
  core/common                    KMP: commonMain (Outcome, AedstError, UseCase, ports) + androidMain (Hilt, Logcat)
  core/database                  KMP: commonMain (Room 3 database, DAO, entity) + androidMain (Hilt, Android driver)
  core/outbox, core/network, core/ui, core/navigation, core/datastore, core/security, core/media,
  core/capabilities, core/analytics, core/testing, core/ui-tv      Android libraries (unchanged)
```

Domain modules exist for `auth`, `tasks`, `admin`, `notifications` and `search`. `feature/media` has no domain of its
own (its repository lives in `core/media`).

| Source set | Holds | May import |
|---|---|---|
| `commonMain` | Entities, value-class ids, repository and queue ports, use cases, `Outcome` / `AedstError` | `kotlin.*`, `kotlinx.coroutines`, other `commonMain` code; in `core/database` also `androidx.room3` (a multiplatform library) |
| `androidMain` | Hilt modules, `@Inject` classes, Android APIs (`LogcatLogger`, `DatabaseModule`) | anything approved for Android |
| `jvmMain` | Nothing yet. The target exists so common code compiles and is tested without the Android SDK | JVM libraries |
| `commonTest` | `kotlin.test` tests, run by `jvmTest` and `testAndroidHostTest` | `kotlin.test`, `kotlinx-coroutines-test` |

## Decisions

- **Domain as a separate module, not a multiplatform feature module.** The alternative was to make `feature/<name>`
  itself multiplatform (domain in `commonMain`, data and presentation in `androidMain`). A separate
  `:feature:<name>:domain` was chosen because: the boundary is a Gradle edge, so a domain cannot reach data or
  presentation even by accident; the domain compiles and is tested on its own (feature modules need the generated
  ConnectRPC client, the domain does not); Hilt and Compose keep the plain `com.android.library` plugin they are
  verified with; and "module, then feature" ([modules and features](/architecture/modules-and-features)) is unchanged,
  with `domain` as a reserved directory name inside a module. `check-feature-boundaries.sh` rule 5 enforces it.
- **Convention plugin `aedst.kmp.library`** (`build-logic`): `org.jetbrains.kotlin.multiplatform` +
  `com.android.kotlin.multiplatform.library` (AGP 9 does not accept `com.android.library` next to the multiplatform
  plugin), `jvm()`, the default hierarchy template, explicit API mode, JUnit Platform for both test tasks, detekt
  through the type-resolved `detektMainJvm` / `detektMainAndroid`, and the aliases `testDebugUnitTest` (runs `allTests`)
  and `koverVerifyDebug` (runs `koverVerify`) so the repository-wide Gradle commands do not skip shared code.
- **No DI annotations in common code.** `javax.inject` is JVM-only. Use cases are plain classes; the feature's Hilt
  module constructs them with `@Provides` (`TasksModule`, `AuthModule`).
- **Time and ids.** `kotlin.time.Instant` / `kotlin.time.Clock` replace `java.time` in domains and in the injected
  clock; `kotlin.uuid.Uuid` replaces `java.util.UUID`. Formatting stays at the UI edge with `java.time` (`TaskUi.kt`,
  `toJavaInstant()`). `TaskId` is a `@JvmInline value class`; navigation keys and the wire keep the raw string.
  The other features still pass raw `String` ids (not mechanical: their ids are shared with media and navigation).
- **Room.** `AppDatabase`, `OutboxDao` and `OutboxEntity` are common code. Room generates the `actual` of
  `expect object AppDatabaseConstructor` per target; expect/actual classes are Beta in Kotlin, enabled with
  `-Xexpect-actual-classes` in `core/database` only. Android keeps `AndroidSQLiteDriver`; the JVM test uses
  `androidx.sqlite:sqlite-bundled`.

## Steps and status

| # | Step | Status |
|---|---|---|
| 1 | First green CI run on the current code | **Not done.** The owner exception allowed starting the structure before it |
| 2 | Pure domain: `kotlin.time`, no `javax.inject`, value-class ids | Done for `core/common` and all five domains; `TaskId` only |
| 3 | `aedst.kmp.library`, `core/common` and each feature domain in `commonMain` | Done |
| 4 | `core/database` (Room 3) and the outbox to common; WorkManager stays `androidMain` | **Partly.** Database, DAO and the outbox table are common. `core/outbox` (repository, handler contract, WorkManager worker and scheduler) is still an Android library |
| 5 | Network to common | Not started (blocked, see below) |
| 6 | Hilt to Metro | Not started (blocked, see below) |
| 7 | UI | Stays `androidMain` unless Compose Multiplatform is adopted by a separate decision |

### What was compiled (Windows, JDK 21, Gradle 9.9.2, AGP 9.5.2, Kotlin 2.5.0-RC, 2026-11-21)

| Module | android target | jvm target | Tests |
|---|---|---|---|
| `core/common` | compiled (with Hilt KSP) | compiled | 5 tests on each target |
| `core/database` | compiled (Room + Hilt KSP) | compiled (Room KSP) | 14 Robolectric host tests (1 skipped on Windows), 1 JVM test |
| `feature/{auth,tasks,admin,notifications,search}/domain` | compiled | compiled | `tasks`: 14 tests on each target |
| `core/{ui,ui-tv,navigation,datastore,security,network,outbox,analytics,testing}` | compiled against the multiplatform `core/common` and `core/database`; `core/outbox` unit tests pass | n/a | |

**Static only, never compiled here:** every `feature/*` Android module, `core/capabilities`, `core/media`, `app`,
`app-tv`. They need the generated ConnectRPC client (`make generate`) and compileSdk 37.1. Their edits for steps 2
and 3 (imports, `TaskId`, `@Provides` for use cases, `kotlin.time`) are mechanical but **UNVERIFIED**; ktlint passes
on them. Expect compile errors on the first real build and record them in [decisions/android](/decisions/android).

Also unverified: Android Lint on multiplatform modules (AGP registers no lint task for their main source set; the
application modules lint dependencies), and the `MigrationTestHelper` test with the schema directory as a host-test
asset (skipped on Windows).

## What the remaining steps need

**Rest of step 4, `core/outbox`.** `OutboxHandler`, `OutboxItem` and `OutboxRepository` can move to `commonMain` once
`OutboxRepository` loses `@Inject` and depends on a small scheduling port instead of the WorkManager-backed
`OutboxScheduler`. `OutboxSyncWorker`, `OutboxScheduler` and the Hilt module stay `androidMain`. Nothing blocks it.

**Step 5, network.** Blocked. `connect-kotlin`, OkHttp and `protobuf-javalite` are JVM-only, so `core/network`,
`core/capabilities`, `core/media` and every `Connect*Repository` cannot be common code. The recorded path is the
switch to Square Wire (multiplatform messages and gRPC client), which is itself blocked on evidence that gRPC reaches
the server through the real edge (see the Wire row in [decisions/android](/decisions/android)). Needed, in order:
the edge evidence; Wire code generation in `buf.gen.yaml`; `core/network` split into a common client and per-target
engines; each repository moved from `feature/<name>/data` to the domain module's sibling or a new common data module.
Until then repositories are Android code behind common ports, which is why the ports live in the domain modules.

**Step 6, Hilt to Metro.** Blocked on step 5 in practice. Hilt and Dagger are JVM-only, so all DI wiring stays in
`androidMain` and in Android modules. Metro is the recorded replacement (the Hilt decision row names KMP as its
revisit trigger), but replacing Hilt is only worth it once data and network are common; today it would rewrite every
`@HiltViewModel` and `@HiltWorker` for no shared code gained. It also needs an owner decision: Hilt is "kept by owner
decision".

**Step 7, UI.** `core/ui`, every screen and ViewModel stay Android. Compose Multiplatform is a separate decision (it
would replace `androidx.compose` artifacts with JetBrains ones, Navigation 3, previews and Roborazzi included).
Without it, an iOS target shares domain and persistence and writes its UI in SwiftUI.

## How to add an iOS target

Needs macOS with Xcode; nothing below was tried in this repository.

1. In `KmpLibraryConventionPlugin.kt`, at the marked line, add `iosArm64()` and `iosSimulatorArm64()`. The default
   hierarchy template then creates `iosMain` / `appleMain` / `nativeMain` for every multiplatform module.
2. Provide the per-target pieces `commonMain` leaves open: a `DispatcherProvider` (in `iosMain`, `Dispatchers.IO` is
   available on native through `kotlinx.coroutines.IO`), a `Logger`, and a `NetworkMonitor`.
3. `core/database`: add `kspIosArm64` / `kspIosSimulatorArm64` with the Room compiler, depend on
   `androidx.sqlite:sqlite-bundled` in `iosMain`, and build the database with
   `Room.databaseBuilder<AppDatabase>(name = <path in NSDocumentDirectory>).setDriver(BundledSQLiteDriver())`.
4. Implement each feature's repository ports for iOS. Until step 5, there is no common network client: either call
   the API from Swift and pass implementations in, or do step 5 first.
5. Export a framework from an umbrella module (`binaries.framework`) and consume it from the Xcode project; wire the
   use cases by hand or with the DI container chosen in step 6.
6. Add the iOS compile and test tasks to CI on a macOS runner, and update `status.md`.

`check-feature-boundaries.sh` already rejects `android.*`, `java.*`, `javax.*` and `dagger.*` imports in
`commonMain`, so common code that passes the gate has no JVM-only import to remove on that day.
