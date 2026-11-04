# core:ui — Aedst Design System (Jetpack Compose)

Compose equivalent of the web app's shadcn/ui component library (`apps/web/shared/ui/`), built to the same semantic-token parity. See [CONVENTIONS.md](../../../../CONVENTIONS.md) for the naming rules every file here follows.

## Tokens (`theme/`)

Design tokens are **generated** from `packages/design-tokens/tokens` (single source for all platforms; see that README). Do not edit the `Aedst*` files marked GENERATED — edit the JSON and run `pnpm --dir packages/design-tokens build`.

| File | Purpose |
|---|---|
| `theme/AedstLightPalette.kt`, `theme/AedstDarkPalette.kt` | GENERATED. Full light/dark semantic palettes (background/foreground, card, popover, primary/secondary/muted/accent + foregrounds, destructive, success, warning, border/input/ring, chart1..5, sidebar*). |
| `theme/AedstSpacing.kt`, `AedstRadius.kt`, `AedstElevation.kt` | GENERATED. `Dp` scales (`AedstSpacing.none`..`giant`, `AedstRadius.xs`..`full`, `AedstElevation.none`..`level5`). |
| `theme/AedstTypeScale.kt` | GENERATED. Font size (`sp`), line height (`Dp`) and weight (`const val`) per Material text style. |
| `theme/AedstMotion.kt` | GENERATED. Animation durations in ms (`const val`). |
| `theme/AedstShapesScale.kt` | `RoundedCornerShape`s built from the generated radius scale. |
| `theme/ExtendedColors.kt` | `AedstExtendedColors` + `LocalAedstExtendedColors` CompositionLocal for tokens with no Material3 `ColorScheme` slot (chart series, sidebar family), and `LocalAedstDarkTheme`: whether `AedstTheme` chose the dark palette. Components that pick palette tokens (`AedstAlert`'s success/warning) read that, never `isSystemInDarkTheme()`, so a theme forced dark or light stays consistent. Access the extended colors via `AedstThemeExtras.extendedColors` inside any `@Composable`. |
| `theme/Theme.kt` | `AedstTheme` — builds `lightColorScheme`/`darkColorScheme` from the generated palettes and provides the Material3 scheme, `LocalAedstExtendedColors` and `LocalAedstDarkTheme`. |
| `theme/Type.kt` | `AedstTypography` built from `AedstTypeScale`. |
| `theme/Shape.kt` | Built from `AedstShapesScale`. |

## Components (`components/`)

30 files, one `PascalCase.kt` file per public composable's main type, each with light+dark `@Preview` pairs wrapped in `AedstTheme { Surface { ... } }`. The kit was pruned to what the app and a five-feature template use (plus the common form/overlay primitives a new feature reaches for first); components with no usage were removed rather than kept as dead code. Re-add one from git history when a feature needs it, together with its `ComponentCatalog` entry.

| Category | Components |
|---|---|
| Layout | `AedstCard` (+Header/Title/Description/Content/Footer slots), `AedstDivider` |
| Actions | `AedstButton` (variant/size enums, loading+disabled), `AedstIconButton`, `AedstFab`, `AedstFilterChip` |
| Forms | `AedstTextField`, `AedstTextArea`, `AedstLabel`, `AedstCheckbox`, `AedstSwitch`, `AedstRadioGroup`, `AedstSelect`, `AedstDatePicker` |
| Feedback | `AedstAlert` (optional `actions` row: retry, discard), `AedstAlertDialog`, `AedstSnackbar`, `AedstProgressIndicator` (linear+circular), `AedstSkeleton` (+Text), `AedstBadge`, `AedstCountBadge`, `AedstOfflineBanner`, `LoadingIndicator` |
| Overlay/Nav | `AedstDialog`, `AedstBottomSheet`, `AedstDropdownMenu`, `AedstTopAppBar`, `AedstTabs` |
| Data display | `AedstAvatar` |
| Errors | `ErrorMessages.kt`: `AedstError.userMessage()` (the localized text of an error kind) and `AedstErrorSnackbarEffect` (shows it once; `onRetry` adds a "Retry" action to retryable kinds) |
| Screens | `screens/UpgradeRequiredScreen.kt`: the blocking forced-upgrade screen (ADR-0009) |

Removed as unused: Accordion, ExpandableSection, BottomNavigationBar (NavigationSuiteScaffold replaces it), Breadcrumb, Carousel, Chart, CommandPalette, ContextMenu, DataTable, Drawer, LongPressPreview, Popover, OtpInput, Pagination, ScrollArea, SearchableDropdown, Slider, ToggleButton, ToggleGroup, Tooltip, AspectRatioBox.

## Adaptive layout (`adaptive/`)

Screens adapt to the window, not the device: `rememberAedstWidthClass()` (compact < 600dp <= medium < 840dp <= expanded, from `currentWindowAdaptiveInfoV2()`), `AedstAdaptiveContent` (centers single-pane content at `AedstContentWidth.form|reading|list|wide` and keeps it in the larger half when a fold or hinge separates the window, see `hingeSafeInsets`) and the `@AedstWindowSizePreviews` multi-preview (compact/medium/expanded). The tasks list uses the Material 3 list-detail pane scaffold, which places panes around hinges itself. Tests: `AedstWidthClassTest`, `AedstHingeInsetsTest` (JVM) and per-feature Robolectric size tests.

## Deliberate adaptations vs. web's shadcn catalog

- **Sheet** -> `AedstBottomSheet` (`ModalBottomSheet`).
- **NavigationMenu** -> `AedstTopAppBar` here; the bottom bar / rail is the app's `NavigationSuiteScaffold`.
- **Menubar, HoverCard, Command, Combobox** -> intentionally not provided on Android.
- Avatar image loading: no image-loading dependency in this module (Coil lives in `core/media`), so `AedstAvatar`'s `imageUrl` is accepted but always renders the initials fallback.

## Tests and verification status

Every public component is rendered through `ComponentCatalog` (`src/sharedTest`): Roborazzi screenshots (light, dark, 200 % font, RTL), touch-target and label checks on the semantics tree (`ComponentSemanticsTest`, built on `core/testing`'s `assertScreenSemantics`, which every feature's `*ScreenTest` also uses), and the instrumented Accessibility Test Framework run (`ComponentAccessibilityTest`, needs an emulator). Golden images are recorded on Linux CI.

`./gradlew testDebugUnitTest :app:assembleDebug lintDebug ktlintCheck detekt` passes on the JVM (see [status](../../../../docs/content/status.md)); nothing here has run on a device or emulator.

Before merging, run `./gradlew :core:ui:compileDebugKotlin ktlintCheck detekt` (see root `CONVENTIONS.md`).
