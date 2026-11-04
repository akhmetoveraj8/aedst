# Naming: Apple (Swift / SwiftUI, `apps/apple`)

Part of [CONVENTIONS.md](../../../CONVENTIONS.md). Levels: **Must** = enforced (linter/CI), **Should** = needs a one-line PR justification to deviate, **Could** = preference.

| What | Rule | Example | Why | Level |
|---|---|---|---|---|
| File | `PascalCase.swift`, file name = main type name | `TaskListViewModel.swift` | Official Swift API Design Guidelines and Xcode template convention: one top-level type = one file with its name | Must |
| SwiftUI View / screen | `PascalCase`, `View` suffix (a screen is also `View`, not `Screen`) | `TaskListView`, `TaskDetailsView` | `View` is the SwiftUI protocol the type implements; `*Screen` is not used in the Apple ecosystem, `*View` is the SwiftUI community and framework standard (`NavigationView`, ...) | Must |
| ViewModel | `ViewModel` suffix; with native Observation use `@Observable final class` (not `ObservableObject`) | `TaskListViewModel` | Same role names as Android/Web for cross-platform uniformity | Must |
| Repository / Service / UseCase | Suffix by role; protocol without a prefix, concrete implementation with a descriptive name (not `Impl`) | `protocol TaskRepository`, `final class PostgresTaskRepository: TaskRepository` | Swift API Guidelines: avoid Hungarian notation (`IFoo`) and the generic `Impl` suffix; the concrete name describes *how* it is implemented | Must |
| Repository implementation | `<Transport><Name>Repository` (`ConnectTaskRepository`, `OIDCAuthRepository`); never `Impl` | `Data/ConnectTaskRepository.swift` | Same rule as Android and Desktop | Must |
| Outbox | A handler implements `OutboxHandler.deliver(_:)` (same verb on Android and Desktop) | `Data/TaskOutboxHandlers.swift` | One word for "send this queued write" on every client | Must |
| Capabilities and upgrade | `CapabilityResolver.isEnabled`, `ServerCapabilities`, `CapabilitiesService`, `ClientUpgradeInterceptor` | `AedstCore/Capabilities`, `AedstNetwork/ClientUpgradeInterceptor.swift` (response side) | The same names on Android | Should |
| Request headers | `RequestHeadersInterceptor` stamps `X-Aedst-Client`; `ClientUpgradeInterceptor` only reads responses | `AedstNetwork/RequestHeadersInterceptor.swift` | Same split as Android `core/network` | Should |
| Use case | One file per use case in `Domain/`, named after the type | `Domain/CreateTaskUseCase.swift` | Matches Android `domain/CreateTaskUseCase.kt` | Should |
| Route | Every route enum lives in `Core/AedstNavigation/.../AedstRoutes.swift`; the feature keeps only its `*Destinations` modifier in `Navigation/<Feature>Destinations.swift` | `TasksDestinations.swift` | Any feature can push any route without importing another feature (Android: `core/navigation` keys) | Must |
| Contract replay test | `<Behavior>ReplayTests` named after `docs/contract/behavior/<behavior>.json`, loading it with `BehaviorFixture` (`AedstTesting`) | `OfflineOutboxReplayTests`, `CapabilitiesReplayTests` | Greppable across platforms: `features.yaml` evidence points at these files | Should |
| Analytics event | Names come from `docs/contract/analytics-events.json`; `task check:analytics` fails on a name that is not listed | `TaskListViewModel.swift` | One vocabulary for web, Android, Apple and Desktop | Must |
| `protocol` | `PascalCase`; describes a capability: a noun, or `-able`/`-ing` for behavior | `TokenProvider`, `Loggable` | Official Swift API Design Guidelines | Must |
| Functions / variables / properties | `camelCase` | `func completeTask()`, `var isLoading` | Swift API Design Guidelines | Must |
| `enum` | `PascalCase`, cases `camelCase` | `enum TaskStatus { case todo, inProgress, done }` | The Swift API Design Guidelines fix lowerCamelCase for `case`; the only one of the five ecosystems that does | Must |
| Constants (`let`, `static let`) | `camelCase` | `static let maxTitleLength = 200` | Swift has no separate "constant" case: `let` already signals immutability; `SCREAMING_CASE` is an anti-idiom in the Swift community (ObjC legacy) | Must |
| SPM module/package name | `PascalCase` | `AedstCore`, `AedstNetwork`, `AedstDesignSystem` | Chosen over camelCase because (1) it matches existing repo code (`Core/AedstCore`, `Core/AedstNetwork`); (2) it matches Apple's own frameworks (`Foundation`, `SwiftUI`, `Combine`): a module is imported as a namespace type, not a value | Must |
| Assets (`.xcassets`, `Color`/`Image` resources) | `camelCase` | `taskStatusDone`, `iconArrowBack` | Xcode generates typed accessors (`Asset.taskStatusDone`) via SwiftGen-style codegen; matches ordinary Swift property naming | Must |
| Test files / functions | Swift Testing (all unit tests): file `<Type>Tests.swift` holding `@Suite("...") struct <Type>Tests`; each test is `@Test("behaviour as a sentence") func <camelCaseBehaviour>()` with **no `test` prefix**. XCUITest (`App/UITests`, XCTest) keeps the `test<Behavior>()` prefix because XCTest discovers by it | `AppDependenciesTests.swift`, `@Test("a refresh keeps the new tokens") func refreshKeepsNewTokens()`; UI: `func testStartScreenPassesAccessibilityAudit()` | Swift Testing discovers `@Test` by attribute, so a prefix adds nothing; the display name is the sentence. XCTest still needs the prefix | Must |

## Anti-patterns

```swift
// BAD struct task_list_view: View { ... }            // a type is PascalCase: TaskListView
// BAD enum TaskStatus { case TODO, IN_PROGRESS, DONE } // Swift enum cases are camelCase: todo, inProgress, done
// BAD protocol ITaskRepository { ... }                // Hungarian notation is foreign to Swift: TaskRepository
// BAD static let MAX_TITLE_LENGTH = 200               // a Swift constant is camelCase: maxTitleLength
// BAD import aedstCore                                 // a module is PascalCase: AedstCore
```

## Machine-enforced code rules (not naming, but they fail CI)

Source of truth: `custom_rules` in `apps/apple/.swiftlint.yml` (messages say what to use instead); run anywhere with
`bash apps/apple/scripts/check-swiftlint-rules-static.sh`. Summary: no `ObservableObject`, Combine, SwiftData, CoreData, `UserDefaults`,
`print`, `AsyncImage`, raw `.sheet(` in Features, `NavigationLink(destination:)`, `Task.sleep(nanoseconds:)`; no `Task.detached` without
`// concurrency-ok: reason`; no `Date()` in `Presentation/` or `App/` (inject `AedstClock`); no literal `Text("...")` (escape `// i18n-ok`);
SDK imports and generated `Aedst_*_V1_*` types only in their owning package/layer. Full table: [library-first/apple](../../content/library-first/apple.md).
