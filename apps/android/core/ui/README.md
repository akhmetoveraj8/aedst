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

66 files, one `PascalCase.kt` file per component, each with light+dark `@Preview` pairs wrapped in `AedstTheme { Surface { ... } }`. The kit covers the whole `ui-kit.yaml` manifest (the 59 shadcn/ui names plus `trace` and `code-block`): 58 component files, 2 entries the platform provides (`aspect-ratio` = `Modifier.aspectRatio`, `scroll-area` = scroll modifiers and lazy lists) and `toast`, an alias of `sonner`. Variant and size enums carry exactly the manifest's names in `SCREAMING_SNAKE_CASE` (`icon-xs` is `ICON_XS`).

| Category | Components |
|---|---|
| Layout | `AedstCard` (+Header/Title/Description/Content/Footer slots), `AedstDivider`, `AedstResizable`, `AedstSidebar` (+`AedstSidebarMenuButton`), `AedstButtonGroup` |
| Actions | `AedstButton` (variant/size enums, loading+disabled), `AedstToggle`, `AedstToggleGroup`, `AedstIconButton`, `AedstFab`, `AedstFilterChip` |
| Forms | `AedstForm`, `AedstField`, `AedstTextField`, `AedstTextArea`, `AedstInputGroup` (+`AedstInputGroupButton`), `AedstInputOtp`, `AedstLabel`, `AedstCheckbox`, `AedstSwitch`, `AedstRadioGroup`, `AedstSelect`, `AedstNativeSelect`, `AedstCombobox`, `AedstSlider`, `AedstCalendar`, `AedstDatePicker` |
| Feedback | `AedstAlert` (optional `actions` row: retry, discard), `AedstAlertDialog`, `AedstSnackbar`, `AedstProgressIndicator` (linear+circular), `AedstSpinner`, `AedstSkeleton` (+Text), `AedstBadge`, `AedstEmpty`, `AedstCountBadge`, `AedstOfflineBanner`, `LoadingIndicator` |
| Overlay | `AedstDialog`, `AedstBottomSheet`, `AedstSheet`, `AedstPopover`, `AedstHoverCard`, `AedstTooltip`, `AedstDropdownMenu`, `AedstContextMenu` |
| Navigation | `AedstTopAppBar`, `AedstTabs`, `AedstBreadcrumb`, `AedstPagination`, `AedstMenubar`, `AedstNavigationMenu`, `AedstCommand`, `AedstAccordion`, `AedstCollapsible` |
| Data display | `AedstAvatar`, `AedstItem`, `AedstTable`, `AedstDataTable`, `AedstChart`, `AedstCarousel`, `AedstTypography`, `AedstKbd`, `AedstCodeBlock`, `AedstTrace` |
| Errors | `ErrorMessages.kt`: `AedstError.userMessage()` (the localized text of an error kind) and `AedstErrorSnackbarEffect` (shows it once; `onRetry` adds a "Retry" action to retryable kinds) |
| Screens | `screens/UpgradeRequiredScreen.kt`: the blocking forced-upgrade screen (ADR-0009) |

## Adaptive layout (`adaptive/`)

Screens adapt to the window, not the device: `rememberAedstWidthClass()` (compact < 600dp <= medium < 840dp <= expanded, from `currentWindowAdaptiveInfoV2()`), `AedstAdaptiveContent` (centers single-pane content at `AedstContentWidth.form|reading|list|wide` and keeps it in the larger half when a fold or hinge separates the window, see `hingeSafeInsets`) and the `@AedstWindowSizePreviews` multi-preview (compact/medium/expanded). The tasks list uses the Material 3 list-detail pane scaffold, which places panes around hinges itself. Tests: `AedstWidthClassTest`, `AedstHingeInsetsTest` (JVM) and per-feature Robolectric size tests.

## Deliberate adaptations vs. web's shadcn catalog

- **Alert**: the manifest set is `DEFAULT`, `DESTRUCTIVE`. `AedstAlertAccent.WARNING` is an Android extension used by the app's outbox and sign-in banners; the former `INFO` and `SUCCESS` variants are gone.
- **Drawer** -> `AedstBottomSheet` (`ModalBottomSheet`); **Sheet** -> `AedstSheet` (a full-window `Dialog` with an edge-aligned panel: Material 3 has no modal side sheet for Compose).
- **NavigationMenu** -> `AedstNavigationMenu` wraps the Material 3 bottom `NavigationBar`; switching bar / rail / drawer by window size stays with the app's `NavigationSuiteScaffold`.
- **HoverCard** -> Material 3 rich tooltip (touch-and-hold, hover, keyboard focus); **ContextMenu** -> touch-and-hold plus an "Open menu" accessibility action.
- **NativeSelect** -> a field that opens a modal single-choice list (the platform spinner's dialog mode).
- **Chart** -> a minimal Canvas bar / line chart with a legend, no axes or tooltips. No chart library is approved for Android; anything richer needs an owner decision.
- **CodeBlock** has no syntax highlighting (needs a tokenizer library: owner decision) and hoists copying to `onCopy`.
- **Form** is layout only: Compose has no form element, validation and submission stay in the ViewModel.
- Avatar image loading: no image-loading dependency in this module (Coil lives in `core/media`), so `AedstAvatar`'s `imageUrl` is accepted but always renders the initials fallback.

## Tests and verification status

Every public component is rendered through `ComponentCatalog` (`src/sharedTest`): Roborazzi screenshots (light, dark, 200 % font, RTL), touch-target and label checks on the semantics tree (`ComponentSemanticsTest`, built on `core/testing`'s `assertScreenSemantics`, which every feature's `*ScreenTest` also uses), and the instrumented Accessibility Test Framework run (`ComponentAccessibilityTest`, needs an emulator). Golden images are recorded on Linux CI.

`./gradlew testDebugUnitTest :app:assembleDebug lintDebug ktlintCheck detekt` passes on the JVM (see [status](../../../../docs/content/status.md)); nothing here has run on a device or emulator.

Before merging, run `./gradlew :core:ui:compileDebugKotlin ktlintCheck detekt` (see root `CONVENTIONS.md`).
