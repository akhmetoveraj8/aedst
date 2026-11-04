# apps/android - AI agent instructions

Read the root [AGENTS.md](../../AGENTS.md) and [CONVENTIONS.md](../../CONVENTIONS.md) first; this file only adds
what is specific to the Compose app. Reference module for everything below: `feature/tasks`. Approved libraries:
[library-first/android](../../docs/content/library-first/android.md). Decisions:
[decisions/android](../../docs/content/decisions/android.md). Naming: [conventions/android.md](../../docs/agent/conventions/android.md).

Verification status: ktlint, detekt, lint, unit tests and `assembleDebug` have run on a JVM; nothing has run on a
device or emulator. Say so ([status](../../docs/content/status.md)).

## Pairs: when you do X, use Y

| When you add | Use | Copy / read | Test |
|---|---|---|---|
| A screen | Compose in `presentation/<screen>/` as a stateless `*Screen(state, onIntent)` plus a `*Route` that collects the `@HiltViewModel` state; the ViewModel follows the "ViewModel contract" in `docs/content/android/architecture.md` (state, sealed intent, effect channel, one `Job` per load, `SavedStateHandle` for drafts) | `feature/tasks/.../presentation/create/` | ViewModel test (Turbine, `kotlinx-coroutines-test`); a `*ScreenTest` per `*Screen.kt` (Robolectric) that calls `assertScreenSemantics` from `core/testing` |
| A route / navigation | A `@Serializable NavKey` in `core/navigation`, an entry in the feature's `AedstNavGraph`, listed in `app/.../navigation/AppNavHost.kt`. Features never import each other | `feature/tasks/.../navigation/TasksNavGraph.kt` | `check-feature-boundaries.sh` |
| An RPC call | The generated connect-kotlin client behind a repository interface in `domain/`, implementation in `data/`, bound in a Hilt module; return `Outcome<T>`, never throw. No Retrofit, no hand-written DTOs | `ConnectTaskRepository.kt`, `TasksModule.kt` | `ConnectTaskRepositoryTest.kt` |
| An error shown to the user | `AedstError` mapped to a localized string by `core/ui` `ErrorMessages.kt`; messages in the error are for logs only | `core/common/Outcome.kt` | ViewModel test asserts the error type |
| A write that must survive offline | An `OutboxHandler` bound `@IntoSet` in the feature's Hilt module, a use case that is online-first and queues the **same operation id** when offline or after a retryable failure; send the outbox id as `Idempotency-Key` (`idempotencyHeaders()`); every direct write sends a fresh key too. WorkManager drains it | `feature/tasks/.../data/TaskOutbox.kt`, `CreateTaskUseCase.kt`, `core/outbox/OutboxHandler.kt` (contract in the KDoc) | `TaskOutboxHandlerTest` (MockWebServer), `TaskOutboxDeliveryTest` (the real worker) |
| Background work | WorkManager (`@HiltWorker`) in `core/outbox`; no own scheduler, no polling, no `AlarmManager` | `core/outbox/OutboxSyncWorker.kt` | `work-testing` |
| A setting or local value | DataStore (typed, protobuf) in `core/datastore` (build it with `createUserPrefsDataStore`: a corrupt file falls back to the defaults); secrets only via Keystore + Tink in `core/security` (never `security-crypto`) | `UserPreferencesSerializer.kt` | JVM test with a temp file |
| Local data that belongs to the signed-in user (a queue, a cache, a counter) | A `SignOutHook` bound `@IntoSet` that wipes it in `onSessionEnded` (runs on sign-out and on a rejected refresh token) | `core/outbox/OutboxSignOutHook.kt` | a hook test |
| A UI element | `core/ui/components/Aedst*` first; add a new one there with `@Preview` and a screenshot test, not inside a feature | `core/ui/components/AedstButton.kt` | Roborazzi in `core/ui` (goldens are recorded in CI on Linux) |
| A color, spacing, type size | The generated theme in `core/ui/theme` (`AedstSpacing`, palettes); no `Color(0x...)` literals | `Theme.kt` | `task check:colors`, `scripts/check-policies.sh` |
| A user-facing string | `feature/<m>/src/main/res/values{,-en,-ar,-tg,-uz}/strings.xml`, all five; `values/` is the default (Russian). `stringResource`, never a literal in Kotlin | `feature/tasks/src/main/res/` | `task check:i18n` |
| An analytics event | `AnalyticsTracker` from `core/analytics` (no-op until consent and key) | `AccountViewModel.kt` | fake tracker in the ViewModel test |
| A new feature module | `feature/<name>` with `domain`, `data`, `presentation`, `navigation`; `include(":feature:<name>")` in `settings.gradle.kts`; apply `libs.plugins.android.feature.convention`; wire in `app/build.gradle.kts` | `feature/tasks/build.gradle.kts` | `check-feature-boundaries.sh` |

## Rules that bite

- Toolchain: JDK 21 only. Run `make generate` (buf) once before the first build; `core/network/src/main/kotlin-gen/**`
  is generated and read-only (a PreToolUse hook refuses edits).
- Rejected: Retrofit, Koin, `security-crypto`, `tv-foundation` lists, a different JDK, Navigation Compose 2.x.
  `kotlinx.serialization` is for navigation keys and local JSON only; the API is protobuf.
- Hilt stays (owner decision). A ViewModel with arguments uses `@HiltViewModel(assistedFactory = ...)`.
- Files stay at or under 300 lines (over 500 fails `task check:file-size`). Detekt covers semantics, ktlint formatting.
- Dependencies come from `gradle/libs.versions.toml` only; a new one needs the Library-First page updated in the same change. `check-catalog-allowlist.sh` fails otherwise.
- No raw `N.dp` or `RoundedCornerShape(` outside `core/ui` (use `AedstSpacing` / `AedstShapesScale`; a size that is not a spacing step carries `// allow-dp: reason`). Raw Material 3 `IconButton`, `FloatingActionButton`, `TextButton`, `FilterChip`, `AlertDialog`, `Badge`, `HorizontalDivider`, `CircularProgressIndicator` are banned in features: use the `Aedst*` wrappers. `Dispatchers.*` only behind `DispatcherProvider`; `OkHttp` only in network modules; suspending HTTP via `executeAsync()`. Every `*Screen.kt` needs a preview. Screen/ViewModel/Repository/Module classes in features are `internal`.

## Gates (run before saying done)

1. `task android:lint` (ktlintCheck, detekt, lintDebug) and `task android:test` (JVM unit tests); `task android:build` for `assembleDebug`.
2. From `apps/android`: `./scripts/check-feature-boundaries.sh` and `./scripts/check-policies.sh` (CI runs both; the latter also runs the catalog-allowlist, UI-token and RPC-contract gates). After touching a gate, run `./scripts/test-gates.sh` (`--full` adds detekt, Lint and Kover; CI runs it): it seeds one violation per gate and proves the gate fails. The gate list is in "Enforced gates" of [library-first/android](../../docs/content/library-first/android.md).
3. `task check` from the repo root (naming, file size, colors, i18n, boundaries).
4. `task android:androidtest` needs an emulator; if it did not run, say so.
