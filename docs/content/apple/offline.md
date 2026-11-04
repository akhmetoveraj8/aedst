---
title: Offline writes and client versioning
description: The Apple outbox, request identification and the forced-upgrade screen, and how they are tested against the shared fixtures.
---

# Apple offline writes, client identification, forced upgrade

Apple counterpart of [ADR-0013](/decisions/0013-android-offline-and-client-security) (outbox) and [ADR-0009](/decisions/0009-api-compatibility-and-client-versioning) (client identification). The behaviour is defined once in `docs/contract/behavior/{offline-outbox,session-refresh,client-version-gate}.json`; the Apple tests replay those files from the repository against the real code. **Nothing here has been compiled or run** (no Swift toolchain on the authoring machine).

## Offline outbox (`offline-outbox`, `idempotency-key`)

| Piece | Where | Android counterpart |
|---|---|---|
| `OutboxItem`, `OutboxHandler`, `OutboxEnqueuing` | `Core/AedstCore/Outbox.swift` | `OutboxItem`, `OutboxHandler` |
| `aedstOutbox` table (migration `core.v2_createOutbox`), `OutboxRecord` | `Core/AedstPersistence` (GRDB) | `OutboxEntity` |
| `OutboxRepository` (actor; `enqueue` ignores a duplicate id) | `Core/AedstPersistence/Outbox` | `OutboxRepository` |
| `OutboxDrainer` (actor; FIFO, batch 50, `maxAttempts` 8) | same | `OutboxSyncWorker` |
| `OutboxSyncCoordinator` + `OutboxBackoff` (30 s doubling, cap 15 min) | same | `OutboxScheduler` + WorkManager backoff |
| `AedstOutbox` (database + repository + coordinator, one call from the composition root) | same | `OutboxModule` |
| Handlers per feature: `TaskOutboxHandlers` (`task.create`, `task.update`) | `Features/Tasks/Data` | `@IntoSet OutboxHandler` |
| `IdempotencyKey.header(for:)` | `Core/AedstNetwork` | header set by the handler |

Rules (all pinned by the fixture): FIFO; the item id is the `Idempotency-Key` of every attempt; a retryable failure (`.network`, `.rateLimited`) records an attempt and stops the run; a permanent failure, an unknown type or the 8th failure parks the item as `failed` and the run continues. Addition not in the fixture: `.upgradeRequired` stops the run without parking or counting an attempt (`OutboxRunResult.blocked`), so a forced upgrade never destroys queued writes.

**Triggers (platform APIs only, no scheduler of our own):** an enqueue (repository hook), `NWPathMonitor` coming back online (`RootViewModel` forwards `ConnectivityMonitoring` to `connectivityChanged`), the app returning to the foreground, and on iOS `BGTaskScheduler` (`BGAppRefreshTask` `com.aedst.apple.outbox-sync`, declared in `App/iOS/Info.plist`; submitted after a retryable failure and when the app goes to the background with writes queued). macOS has no `BackgroundTasks`; it drains on enqueue, reconnect and foreground only. After a retryable failure the in-process retry waits the exponential delay with `AedstClock.sleep`; a newer trigger cancels it.

**Sign-out and session expiry delete the queue** (`OutboxRepository.removeAll()` in `AppDependencies.didSignOut`): a row belongs to the user who made it and must not be delivered under the next user's token. Cost: writes still queued when the session ends are lost. Revisit if involuntary sign-out with pending writes turns out to be common (then key rows by user id and keep them).

**Parked rows are visible, not silent.** A row the drainer gives up on (permanent error, unknown type, 8th failed attempt) stays in the table as `failed`. `OutboxRepository.failedEntries()`/`failedCount(types:)` expose them (`OutboxFailureReporting` in `AedstCore`); the task list shows "N changes were not synced" from `TaskOutboxQueue.failedCount()`, and the drainer's `onParked` hook reports the type and error kind to `AnalyticsClient.recordError` (never the payload). If the on-disk database cannot be used (cannot open, corrupt, not a database, disk full, I/O or permission error) the outbox runs in memory for that process and the app reports the cause once; an error from a migration is a programming error and stops Debug builds. **One key per intent:** `TaskListViewModel` sends the draft id as `Idempotency-Key` on the online create and uses the same id for the queued row, so a lost response plus the offline retry is one write. **Upload completion:** a transfer that finished after the app was killed is queued as `media.complete` (`MediaOutboxQueue`, row id `media.complete:<mediaID>`) and delivered by `MediaOutboxHandlers`, instead of a fire-and-forget request that a suspended process could drop.

**Data protection:** the database is not encrypted (same rule as Room). Payloads must not hold secrets or PII beyond what the server needs. On iOS the database directory uses `completeUntilFirstUserAuthentication`.

**UI wiring (Tasks):** `TaskListViewModel` queues a create that failed for a retryable reason, inserts the row optimistically with a "Waiting to sync" caption (`tasksPendingSync`), and disables opening it (the server does not know it yet). A pull-to-refresh replaces the list with server state, which drops placeholders whose create has not synced yet. `task.update` has a handler and `TaskOutboxQueue.enqueueUpdate` but no screen uses it (there is no edit screen).

## Client identification (`client-identification`)

`RequestHeadersInterceptor` sets `X-Aedst-Client: apple/<semver>` on every unary call, on both the authenticated and the plain client. The version is `CFBundleShortVersionString` (`MARKETING_VERSION`), padded to three components (`2.1` becomes `2.1.0`). A missing or non-numeric version sends **no** header (the server lets unidentified clients through), never a made-up `0.0.0` that the gate would reject.

## Forced upgrade (`forced-upgrade-ux`)

The server answers `failed_precondition` with a `google.rpc.ErrorInfo` detail whose `reason` is `CLIENT_UPGRADE_REQUIRED`. The same interceptor spots it and reports to `ClientUpgradeMonitor`; `RootViewModel.isUpgradeRequired` then shows `UpgradeRequiredView` above everything, including the app lock. `NetworkErrorMapping` returns `AedstError.upgradeRequired` (a distinct case, not `.invalidInput`) for the same response. `ErrorInfo.reason` is read from the protobuf bytes of the detail (field 1) because `ErrorInfo` is not among the generated stubs. The screen has no dismiss action; only an update (a new process) clears it. The App Store button needs `AEDST_APP_STORE_ID` (numeric Apple ID, `Config/Base.xcconfig`; empty means no button, the message still shows). Strings: `appUpgrade*` in `App/Shared`, `errorUpgradeRequired` in `AedstCore`, all five locales.

## Capability negotiation (`capability-negotiation`)

`CapabilitiesService` (`AedstCore`, `@Observable`, `@MainActor`) fetches the public `CapabilitiesService.GetCapabilities` through the plain client (`ConnectCapabilitiesRemote`, no token) at launch (`RootViewModel.run`) and on every return to the foreground, before and after sign-in. A good answer is cached as JSON in the `aedstKeyValue` table (`CapabilitiesCacheStore`, key `capabilities.lastKnown`); a failed fetch keeps the in-memory value, else the cached one, else the defaults.

`CapabilityResolver.isEnabled` is the whole rule set: a feature must be in the build (`AppFeature.built`) and not switched off by the server; with nothing fetched, built-in features are on and flagged ones (`AppFeature.flagged` = `admin`) are off; a feature listed with the typed `Feature.required_client_version` (empty = none) is hidden on older releases (numeric compare through `String.compare(.numeric)`; an unparsable app version disables the version rules rather than guessing). Names the server lists that the build does not know are never looked up. A built feature the response does not list falls back to the defaults (built-in on, flagged off), as the proto comment says; the server lists one coarse entry per module id (`tasks`, `media`, ...) besides dotted/operator names (`media.uploads`, `new_search`; ADR-0009). An explicit `enabled: false` always wins.

Consumers: the home list (`HomeView`) shows an entry only when `RootViewModel.isFeatureEnabled(...)`; `RootView.open(_:)` drops a link whose `AppLink.feature` is disabled (admin also needs the role). `UpdateStatus` and `clients["apple"].minimum` feed the existing upgrade logic: a release below the minimum calls `ClientUpgradeMonitor.report()` (blocking `UpgradeRequiredView`), `isUpdateRecommended` exposes the non-blocking state (no banner yet). Stubs: `capabilities.proto` is in the `make generate` path list.

## Session refresh (`session-refresh`)

Replayed against `AuthorizedRequestExecutor` and the real `KeychainTokenStore`. The replay found one discrepancy that is now fixed: on a transient refresh failure (`RefreshResult.unavailable`) the executor used to hand back the original 401, which mapped to `unauthorized` (not retryable, "sign in again"). It now returns a retryable `unavailable` failure, as the fixture requires ("keeps the session; the request fails as a retryable error"), so the outbox retries and the UI shows a network toast.

## Tests

| Test | Covers |
|---|---|
| `AedstPersistenceTests/OfflineOutboxReplayTests` | every `offline-outbox.json` case against the GRDB outbox and drainer |
| `OutboxTests`, `OutboxSyncCoordinatorTests` | duplicate enqueue, FIFO, blocked-on-upgrade, backoff, connectivity and background triggers |
| `AedstNetworkTests/ClientVersionGateReplayTests`, `ClientVersionTests` | header format, `client-version-gate.json`, ErrorInfo parsing, distinct error |
| `AedstNetworkTests/CapabilitiesReplayTests`, `CapabilitiesMappingTests` | every `capabilities.json` case, minimum-version reporting, version order, proto-to-domain mapping |
| `AedstPersistenceTests/CapabilitiesCacheStoreTests` | last-known round trip, corrupt row |
| `AedstAppSharedTests/SessionRefreshReplayTests` | every `session-refresh.json` case (single flight, sign-out, keep-session) |
| `AedstAppSharedTests/UpgradeAndOutboxWiringTests` | upgrade routing, sign-out clears the queue, handlers match the fixture's `knownTypes` |
| `TasksTests/TaskOutboxTests` | payload round trip, offline create queued, validation never queued |

Fixtures are read from the repository by `AedstTesting.BehaviorFixture` (walks up from the test file to `docs/contract/behavior`), so the repo file is the single source and nothing is copied into a test bundle. This works for `swift test` and `xcodebuild test` on a checkout, not for a test bundle run elsewhere.
