# apps/apple - AI agent instructions

Read the root [AGENTS.md](../../AGENTS.md) and [CONVENTIONS.md](../../CONVENTIONS.md) first; this file only adds
what is specific to the SwiftUI app. Reference module for everything below: `Features/Tasks`. Approved libraries:
[library-first/apple](../../docs/content/library-first/apple.md). Decisions:
[decisions/apple](../../docs/content/decisions/apple.md). Naming: [conventions/apple.md](../../docs/agent/conventions/apple.md).

Verification status: nothing under `apps/apple` has been compiled or run (no Xcode where it was written). Statically
reviewed only; the first Mac build is the acceptance test. Do not claim it builds ([status](../../docs/content/status.md)).

## Pairs: when you do X, use Y

| When you add | Use | Copy / read | Test |
|---|---|---|---|
| A screen | A SwiftUI `*View` plus an `@MainActor @Observable` `*ViewModel` (Observation, not `ObservableObject`) in `Presentation/` | `Features/Tasks/Sources/Tasks/Presentation/TaskListView.swift`, `TaskListViewModel.swift` | Swift Testing: `Tests/TasksTests/TaskViewModelTests.swift` |
| A route | A case on the route enum in `Core/AedstNavigation/.../AedstRoutes.swift` and a `*Destinations` modifier in the feature; `NavigationStack` + `Router` from `AedstNavigation`; composed in `App/Shared` | `Navigation/TasksDestinations.swift` | view-model test of the route's builders |
| An RPC call | The generated connect-swift client behind a repository protocol in `Domain/`, implementation in `Data/`, errors mapped to `AedstError`. No hand-written URLSession JSON clients | `Data/ConnectTaskRepository.swift`, `Domain/TaskRepository.swift` | repository test with a stub transport |
| Dependencies | Constructor injection with a production default; wire it once in `App/Shared/.../AppDependencies*.swift` (composition root). No global singletons, no swift-dependencies (not adopted) | `AppDependencies+Factories.swift` | `AppDependenciesTests.swift` |
| A write that must survive offline | An `OutboxHandler` returned from `make(...)`, send the outbox row id as `Idempotency-Key`; drained by the composition root | `Data/TaskOutboxHandlers.swift`, `Domain/TaskOutboxQueue.swift`, `App/Shared/.../AppDependencies+Outbox.swift` | `Tests/TasksTests/TaskOutboxTests.swift` |
| A persisted setting | GRDB through `AedstDatabase` (`AedstKeyValueRecord`); tokens and secrets only in the Keychain (`KeychainTokenStore`); no SwiftData, no `UserDefaults` for security settings | `Core/AedstPersistence/.../AnalyticsConsentPreference.swift` | persistence tests with an in-memory database |
| An error shown to the user | `AedstError` shown through `aedstErrorPresenter` (bind the view model's `error`) | `Core/AedstDesignSystem/.../Components/AedstErrorPresenter.swift` | view-model test asserts the error |
| A UI element | `Core/AedstDesignSystem` components (`Aedst*`) first; add new ones there with a snapshot test | `Components/AedstButton.swift` | swift-snapshot-testing in `Core/AedstDesignSystem` (references are recorded on a Mac) |
| A color, spacing, font | Design tokens (`AedstColor`, `AedstSpacing`, `AedstTypeScale`); no color literals | `Core/AedstDesignSystem/.../AedstSpacing.swift` | `task check:colors` |
| A user-facing string | `String(localized:)` and the package's `Resources/Localizable.xcstrings` with en, ru, tg, uz, ar | `Features/Tasks/Sources/Tasks/Resources/Localizable.xcstrings` | `task check:i18n` |
| An analytics event | `AnalyticsClient.track(_:)` from `AedstAnalytics`, injected, no-op until consent and key | `TaskListViewModel.swift` | a recording stub in the view-model test |
| A remote image | `AedstRemoteImage` from `Core/AedstMedia` (Nuke, only there); never `AsyncImage` in lists | `Core/AedstMedia` | n/a |
| A feature package | `Features/<Name>/Package.swift` depending on `Core/*` only, layers `Domain`, `Data`, `Presentation`, `Navigation`, `Resources`; add it to `App/Shared/Package.swift` (dependencies and target) and the composition root | `Features/Tasks/Package.swift` | `scripts/check-feature-boundaries.sh` |

## Rules that bite

- Build system is Tuist (`Project.swift`, `Tuist/Package.swift`); the Xcode project is generated and gitignored. No XcodeGen.
- `Features/*` may depend on `Core/*`, never on another `Features/*` package (`scripts/check-feature-boundaries.sh`).
- Generated and read-only: `Core/*/Generated/**`, `Derived/**`, and `AedstLightPalette.swift` / `AedstDarkPalette.swift`
  (tokens: `pnpm --dir packages/design-tokens build`). A PreToolUse hook refuses edits.
- Commit `Package.resolved` files and `Gemfile.lock` after the first Mac run; never gitignore them.
- Rejected: SwiftData, swift-perception, a hand-written image loader, SwiftFormat (nicklockwood), Periphery.
  swift-format formats; SwiftLint only checks semantic rules.
- Files stay at or under 300 lines (over 500 fails `task check:file-size`).
- Library-first is enforced by `custom_rules` in `.swiftlint.yml` (no `ObservableObject`/Combine/SwiftData/`UserDefaults`/`print`/`AsyncImage`/raw `.sheet`/literal `Text("..")`/`Date()` in Presentation; SDK imports only in their Core package). Escapes: `// i18n-ok`, `// concurrency-ok: reason`. Strings with arguments: `String(localized: "key \(x)")` (catalog key `key %lld`/`key %@`), integers need `variations.plural`. New package URLs go in `scripts/approved-packages.txt`.

## Gates (run before saying done)

1. Anywhere: `bash apps/apple/scripts/check-feature-boundaries.sh` (boundaries, colors, file size, `check-dependencies.sh`, `check-apple-sensitive-apis.sh`, `check-swiftlint-rules-static.sh` incl. negative fixtures, `check-apple-swift-policy.sh` for Swift 6 settings, concurrency escapes and the connect-swift stack) and `task check` from the repo root.
2. On a Mac only: `task apple:lint` (swift-format lint + SwiftLint) and `task apple:test` (run `task apple:generate` once first).
3. If step 2 did not run, say that nothing was compiled or tested.
