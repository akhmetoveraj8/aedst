---
title: "UI Kit — cross-platform component parity"
description: "AEDST ships one design system with four platform kits: Web (shadcn/ui, apps/web/shared/ui/), Android (Jetpack Compose, apps/android/core/ui/), Apple..."
---

# UI Kit — cross-platform component parity

AEDST ships one design system with four platform kits: **Web** (shadcn/ui,
`apps/web/shared/ui/`), **Android** (Jetpack Compose,
`apps/android/core/ui/`), **Apple** (SwiftUI,
`apps/apple/Core/AedstDesignSystem/`), and **Desktop** (Slint,
`apps/desktop/crates/aedst-ui/`). A fifth, TV-only surface exists on
Android: `apps/android/core/ui-tv/` (`androidx.tv:tv-material`-based), used
solely by the `:app-tv` module — see
[Android architecture](/android/architecture#phone-and-tv-a-second-thin-app-target)
for why that is a Gradle module boundary and not a fork of the Android column.

The **tokens** (colors, spacing, radius, elevation, typography, motion) are
shared and **generated**; the **components** are hand-written per platform.
Web components are the reference for behavior and naming, but web is **not**
the source of truth for token values: those live in `packages/design-tokens`.

Each platform README documents its own adaptations in full detail; this page is
the cross-platform index and does not duplicate them.

## Tokens (generated, never hand-edited)

Source of truth: DTCG JSON in `packages/design-tokens/tokens/` (`color/light.json`,
`color/dark.json`, `spacing.json`, `radius.json`, `elevation.json`,
`typography.json`, `motion.json`). [Style Dictionary](https://styledictionary.com/)
(`pnpm build` in `packages/design-tokens`, or `task tokens:check` for the drift
check) writes committed files into each platform. Every generated file starts
with `GENERATED — do not edit; edit packages/design-tokens/tokens`.

| Platform | Generated files | Hand-written layer that consumes them |
|---|---|---|
| Web | `apps/web/shared/ui/tokens.css` (`:root` light + scales, `.dark`) | `apps/web/app/src/app/styles/globals.css` (`@theme inline` maps to Tailwind) |
| Android | `core/ui/.../theme/Aedst{Light,Dark}Palette.kt`, `AedstSpacing.kt`, `AedstRadius.kt`, `AedstElevation.kt`, `AedstTypeScale.kt`, `AedstMotion.kt` | `Theme.kt`, `ExtendedColors.kt`, `Type.kt` |
| Apple | `AedstDesignSystem/Aedst{Light,Dark}Palette.swift`, `AedstSpacing.swift`, `AedstRadius.swift`, `AedstElevation.swift`, `AedstTypeScale.swift`, `AedstMotion.swift` | `AedstColor.swift` (adaptive light/dark pairing) |
| Desktop (Rust + Slint) | `apps/desktop/crates/aedst-ui/ui/aedst_tokens.slint` (global) | `aedst_layout.slint` (RTL), `aedst_*.slint` components |


Semantic status colors are tokens too: `success`, `warning`, `info`,
`destructive`, each with a `*Foreground` pair, in light and dark. Components must
use them instead of literals; `task check:colors` enforces this (see
[Platform status](/status#repo-wide-policy-checks)). To add a token see
`packages/design-tokens/README.md`.

## Component parity matrix

Legend: **yes** = implemented (native name in the cell when it differs from
`Aedst<Component>`); **removed** = intentionally not part of that kit (being
pruned from the native kits; see the note below); **n/a** = no equivalent by
design; **web-only** = exists only on web.

How to update: edit the one row, keep the legend words, and change the "Last
checked" line. When a component is added or removed in a platform kit, update
the row in the same change; `apps/*/README` stays the detailed record.

Last checked: 2026-10-08, from the pruning work reports (Android 21 and Apple 30 components removed), **not** re-listed from the file trees; re-run the check once the native kits compile.

| Component (web file) | Web | Android | Apple | Desktop |
|---|---|---|---|---|
| Accordion | yes | removed | removed | yes |
| Alert | yes | yes | yes | yes |
| AlertDialog | yes | yes | yes (`AedstAlertDialogModifier`) | yes |
| Avatar | yes | yes (image loading not wired) | yes | yes |
| Badge | yes | yes | yes | yes |
| Breadcrumb | yes | removed | removed | yes |
| Button | yes | yes | yes | yes |
| Calendar | yes | yes (`AedstDatePicker`) | removed | yes (`AedstCalendar`) |
| Card | yes | yes | yes | yes |
| Carousel | yes | removed | removed | yes |
| Chart | yes (Recharts) | removed | removed | yes |
| Checkbox | yes | yes | yes | yes (`AedstCheckBox`) |
| Collapsible | yes | removed | removed | yes |
| Combobox | yes | removed | removed | yes (`AedstSearchableComboBox`) |
| Command (palette) | yes | removed | removed | yes (`AedstSearchableList`) |
| ContextMenu | yes | removed | removed | yes |
| Dialog | yes | yes | removed | yes |
| Drawer / Sheet | yes | yes (`AedstBottomSheet`) | yes (`AedstSheet`) | yes (`AedstDrawer`) |
| DropdownMenu | yes | yes | removed | yes |
| HoverCard | yes | removed | removed | yes |
| InputOTP | yes | removed | removed | yes (`AedstOtpInput`) |
| Label | yes | yes | yes | yes |
| Menubar | yes | removed (no menubar on Android) | removed | yes |
| NavigationMenu | yes | `AedstTopAppBar` (bottom bar removed; the app uses the platform navigation suite) | removed (`AedstTabBar` and `AedstTabs` pruned; use native `TabView`/`NavigationStack`) | yes (`AedstTabBar`) |
| Pagination | yes | removed | removed | yes |
| Popover | yes | removed | removed | yes |
| Progress | yes | yes (`AedstProgressIndicator`) | yes (`AedstProgressView`) | yes (`AedstProgressBar`, `AedstCircularProgress`) |
| RadioGroup | yes | yes | yes | yes |
| ScrollArea | yes | removed | removed | yes |
| Select | yes | yes | removed | yes (`AedstComboBox`) |
| Separator | yes | yes (`AedstDivider`) | yes (`AedstSeparator`) | yes (`AedstSeparator`) |
| Skeleton | yes | yes | yes | yes |
| Slider | yes | removed | removed | yes |
| Switch | yes | yes | yes | yes |
| Table | yes | removed | removed | yes (`AedstTableView`) |
| Tabs | yes | yes | removed | covered by `AedstTabBar` |
| Textarea | yes | yes (`AedstTextArea`) | removed | yes (`AedstTextArea`) |
| Toast (Sonner) | yes | yes (`AedstSnackbar`) | yes (`AedstToast`) | yes (`AedstToast`) |
| Toggle / ToggleGroup | yes | removed | removed | yes |
| Tooltip | yes | removed | removed | yes (`AedstToolTip`) |
| Input / TextField | yes | yes (`AedstTextField`, password variant) | yes | yes |
| IconButton (`button.tsx` `size="icon"`) | n/a | yes | yes | yes |
| AspectRatio | yes | removed | removed | yes |

Notes:

- **Pruned in this round** (unused native components removed; none compiled):
  Android `core/ui` lost 21 (Accordion, ExpandableSection, BottomNavigationBar,
  Breadcrumb, Carousel, Chart, CommandPalette, ContextMenu, DataTable, Drawer,
  LongPressPreview, Popover, OtpInput, Pagination, ScrollArea,
  SearchableDropdown, Slider, ToggleButton, ToggleGroup, Tooltip,
  AspectRatioBox). Apple `AedstDesignSystem` lost 30 and keeps 18 (Accordion,
  AspectRatio, Breadcrumb, Carousel, Chart, Collapsible, Combobox,
  CommandPalette, ContextMenu, DatePicker, Dialog, Drawer, DropdownMenu,
  HoverCard, MenuBar, NavigationContainer, OTPInput, Pagination, Popover,
  PopoverAdaptationModifier, ScrollArea, Select, Slider, TabBar, Table, Tabs,
  TextEditor, ToggleButton, ToggleGroup, Tooltip). The matrix cells are updated
  from those reports. Desktop is untouched; its kit pruning is still open.
- **Open owner question**: the Apple pruning is broader than the five
  components requested (Carousel, MenuBar, HoverCard, CommandPalette, Chart)
  and removes basics such as Dialog, Select and Tabs. The files are restorable
  from git HEAD; confirm or restore (also tracked in [Platform status](/status)).
- Web has a Storybook 10 story for every `apps/web/shared/ui` component (62), with
  an a11y gate; see [decisions](/decisions/web).
- Native-only helpers (no web file): Android `AedstOfflineBanner`,
  `LoadingIndicator`, `ErrorMessages`; Apple `AedstErrorPresenter` (`AedstNavigationContainer` was pruned),
  Desktop `AedstOfflineBanner`, `AedstStateView`.
- Web-only primitives with no native counterpart: `attachment`, `bubble`,
  `button-group`, `direction`, `empty`, `field`, `input-group`, `item`, `kbd`,
  `marker`, `message`, `message-scroller`, `mode-toggle`, `native-select`,
  `questionnaire`, `resizable`, `sidebar`, `spinner` (native platforms use
  platform navigation chrome and system controls instead).

## Full detail per platform

- [`apps/android/core/ui/README.md`](../../apps/android/core/ui/README.md): Compose components, adaptation rationale, verification status.
- [`apps/android/core/ui-tv/README.md`](../../apps/android/core/ui-tv/README.md): TV-only Compose surface (`:core:ui-tv`).
- [`apps/apple/Core/AedstDesignSystem/README.md`](../../apps/apple/Core/AedstDesignSystem/README.md): SwiftUI components, HIG adaptation rationale.
- `apps/desktop/crates/aedst-ui/ui/`: Slint components and the generated `aedst_tokens.slint`.

Verification: none of the four native READMEs can promise a compiled kit. The
Android, Apple and Desktop components were written without a Gradle/Xcode/Rust
toolchain and are structurally reviewed only; see
[Platform status](/status) for what has actually been run.
