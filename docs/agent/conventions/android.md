# Naming: Android (Kotlin, `apps/android`)

Part of [CONVENTIONS.md](../../../CONVENTIONS.md). Levels: **Must** = enforced (linter/CI), **Should** = needs a one-line PR justification to deviate, **Could** = preference.

| What | Rule | Example | Why | Level |
|---|---|---|---|---|
| File with the main class/screen | `PascalCase.kt`, file name = main class name | `TaskListViewModel.kt` | Official Kotlin style guide (kotlinlang.org): the file name must match the single top-level class | Must |
| Utility file (top-level functions, no single class) | `PascalCase.kt`, named after the content | `DateFormatters.kt` | The official guide allows any descriptive name for files without a single class; PascalCase keeps it consistent with the other `.kt` files | Should |
| Activity / Fragment | `Activity` / `Fragment` suffix | `MainActivity`, `TaskDetailsFragment` | Clearly an Android lifecycle component; the manifest requires it for Activities | Must |
| Composable (screen) | `PascalCase`, `Screen` suffix for full-screen composables | `TaskListScreen`, `TaskDetailsScreen` | Separates "draws the whole screen" from a reusable `@Composable` widget | Must |
| Composable (widget) | `PascalCase`, no suffix | `StatusBadge`, `PriorityChip` | Compose convention: `@Composable` functions are named like PascalCase nouns because conceptually they are UI elements, not procedures | Must |
| ViewModel | `ViewModel` suffix | `TaskListViewModel` | `viewModel()`/Hilt DI resolves by type; the suffix removes ambiguity in the DI graph | Must |
| Repository | Interface `<Name>Repository` (no `I` prefix) in `domain/`; implementation `<Transport><Name>Repository` in `data/` (`ConnectTaskRepository`, `OidcAuthRepository`); no `Impl` suffix | `TaskRepository`, `ConnectTaskRepository` | The transport in the name says what the class talks to and keeps one rule across Android, Apple and Desktop; `IRepository` and `Impl` are Hungarian-style noise in Kotlin | Must |
| UseCase / Interactor | `UseCase` suffix | `CompleteTaskUseCase` | Consistent with the rest of the domain layer; easy to find by the `*UseCase.kt` pattern | Should |
| Flat feature layout | A feature keeps `domain/Task.kt` (entities), `domain/TaskRepository.kt` (the port) and one `domain/<Verb><Noun>UseCase.kt` per operation, flat in `domain/`; the nested `domain/model` + `domain/repository` + `domain/usecase` form of `feature/auth` is legacy and not copied | `feature/tasks/.../domain/CreateTaskUseCase.kt` | The flat form is the canonical one (Tasks is the reference module); Apple and Desktop use the same flat `Domain/` | Should |
| Outbox | Module `core/outbox`, package `com.aedst.core.outbox`; a handler implements `OutboxHandler.deliver(item)` (same verb on Apple and Desktop) | `OutboxHandler.kt` | One word for "send this queued write" on every client | Must |
| Capabilities and upgrade | `CapabilityResolver.isEnabled`, `ServerCapabilities`, `CapabilitiesService`, `ClientUpgradeInterceptor` | `core/capabilities`, `core/network/ClientUpgrade.kt` | The same names on Apple (`CapabilitiesService`, `ClientUpgradeInterceptor`) | Should |
| Contract replay test | `<Behavior>ReplayTest` named after `docs/contract/behavior/<behavior>.json`, loading it with `BehaviorFixture` (`core/testing`) | `OfflineOutboxReplayTest`, `CapabilitiesReplayTest`, `SessionRefreshReplayTest` | Greppable across platforms: `features.yaml` evidence points at these files | Should |
| Analytics event | Names come from `docs/contract/analytics-events.json` (`task_created`); `task check:analytics` fails on a name that is not listed | `TaskCreateViewModel.kt` | One vocabulary for web, Android, Apple and Desktop | Must |
| Functions / variables / properties | `camelCase` | `fun loadTasks()`, `val isLoading` | Kotlin official style guide | Must |
| `Boolean` variables/properties | `is`/`has`/`should` prefix | `isLoading`, `hasOverdueTasks` | Reads as a condition in `if`; matches the Compose/Android SDK convention | Should |
| Constants (top-level or in `companion object`) | `SCREAMING_SNAKE_CASE` | `const val MAX_TITLE_LENGTH = 200` | Kotlin official style guide: constants as in Java, distinguishable from `val` properties | Must |
| `enum class` | `PascalCase`, values `SCREAMING_SNAKE_CASE` | `enum class TaskStatus { TODO, IN_PROGRESS, DONE }` | The official guide fixes exactly this for enum constants (unlike ordinary properties) | Must |
| Packages | `lowercase`, no underscores, reverse domain | `com.aedst.android.navigation` | Official Java/Kotlin package convention; the JVM classloader is case-sensitive | Must |
| Resources (`res/`, IDs in `.xml`) | `snake_case` | `ic_arrow_back`, `task_list_item` | The Android resource manager generates `R.id.task_list_item`; snake_case is the historical SDK convention | Must |
| Compose Preview functions | `Preview` suffix | `TaskListScreenPreview` | Android Studio finds `@Preview` functions by annotation, but the suffix makes them searchable by name | Could |

## Anti-patterns

```kotlin
// BAD class taskViewModel                           // a class is PascalCase: TaskViewModel
// BAD class TaskRepo                                 // abbreviated suffix: TaskRepository, not Repo
// BAD val IsLoading = true                            // properties are camelCase: isLoading
// BAD enum class TaskStatus { Todo, InProgress, Done } // enum values are SCREAMING_SNAKE_CASE: TODO, IN_PROGRESS, DONE
// BAD <TextView android:id="@+id/TaskListItem" />      // resource ID is snake_case: task_list_item
```

## Visibility and tokens (machine-enforced, not naming)

| Rule | Level | Enforced by |
|---|---|---|
| `Screen`, `ViewModel`, `Repository`, `Module` types inside `feature/*` are `internal`; the public surface is the `*NavGraph` | Must | `apps/android/scripts/check-feature-boundaries.sh` |
| Spacing is `AedstSpacing.*`, shapes `AedstShapesScale.*`; a size that is not a spacing step carries `// allow-dp: reason` | Must | `apps/android/scripts/check-ui-tokens.sh` |
| Every `*Screen.kt` has `@AedstWindowSizePreviews` or `@Preview` (in the file or a sibling `*Preview*.kt`) | Must | `apps/android/scripts/check-ui-tokens.sh` |
