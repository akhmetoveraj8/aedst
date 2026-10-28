# AedstDesignSystem

Desktop (Qt Quick / QML) design system for AEDST, built to reach parity with
the web app's shadcn/ui component library (`apps/web/shared/ui/`). Built
on top of the pre-existing architecture in this module — do not introduce a
second, parallel component set:

- **Tokens**: `qml/AedstDesignSystem/AedstTokens.qml` — GENERATED singleton of constants
  (light/dark palettes, spacing, radius, elevation, typography, motion) from
  `packages/design-tokens/tokens` (single source for all platforms; edit the JSON and run
  `pnpm --dir packages/design-tokens build`, never the .qml). The only runtime state is
  `ThemeController` (`include/aedst/designsystem/theme_controller.hpp`): a native `QObject`
  singleton exposing `dark`/`followsSystem`, declared with `QML_ELEMENT`/`QML_SINGLETON`
  in the `AedstDesignSystem` module; the composition root supplies the instance with
  `aedst::qmlsupport::SingletonSlot<ThemeController>::provide()` (`App/src/qml_singletons.cpp`).
- **`Theme.qml`** (`pragma Singleton`) — the façade every component binds
  to. It re-exposes the `AedstTokens` values (picking light or dark from `ThemeController.dark`) under names that mirror the
  CSS custom properties in `apps/web/app/src/app/styles/globals.css` (shadcn's
  "neutral" palette): `background`/`foreground`, `card`, `popover`,
  `primary`, `secondary`, `muted`, `accent`, `destructive`,
  `border`/`input`/`ring`, a 5-color `chart` palette, a radius scale
  (`radiusSm`..`radius2xl`) and a spacing scale (`spacingXs`..`spacing2xl`),
  plus typography (`titleFont`, `headingFont`, `bodyFont`, `smallFont`,
  `captionFont`, `monoFont`) and motion durations. The web oklch() values are converted to sRGB by
  Style Dictionary at build time. **Back-compat aliases** (`surface`, `onPrimary`, `onSurface`,
  `error`, `outline`, `spacing`, `radius`) are kept so the two pre-existing
  consumers (`App/qml/Main.qml`, `Modules/Features/Auth/Presentation/LoginView.qml`)
  keep working unchanged.
- **Components**: `qml/AedstDesignSystem/*.qml`, one per file, listed in `CMakeLists.txt`'s
  `AEDST_DESIGNSYSTEM_QML_FILES` (`qt_add_qml_module`: the qmldir is generated and
  `qmlcachegen` compiles each file ahead of time; add new components only there). Every component reads color/spacing/radius/font values only
  from `Theme`, so light/dark follows `ThemeController.dark`
  (OS-driven by default; `ThemeController.dark = true|false` sets it explicitly and `ThemeController.followSystem()` goes
  back to the OS scheme) with no hardcoded colors. `Theme` also exposes `breakpointSm/Md/Lg` (generated
  `breakpoint` tokens, window width in logical px; the shell collapses its toolbar below `breakpointMd`) and `textScale`
  (the OS text size as a ratio of the platform's stock font, 1 to 2; every token font size is multiplied by it).

Quality bar applied to every component: `variant`/`size` as QML `enum`
declarations (not free-form strings), full dark-mode support via `Theme`,
disabled-state opacity, `busy`/loading states where the shadcn component has
one, `Accessible.role`/`Accessible.name` (and `checked`/`selected`/`disabled`
where relevant), and keyboard handling (`Keys.on*Pressed`, `Tab`-focusable
Qt Quick Controls) where the underlying control supports it.

## Components built

### Layout
| Component | File | Web equivalent |
|---|---|---|
| AedstCard | `AedstCard.qml` | `Card` |
| AedstSeparator | `AedstSeparator.qml` | `Separator` |
| AedstAspectRatio | `AedstAspectRatio.qml` | `AspectRatio` |
| AedstScrollArea | `AedstScrollArea.qml` | `ScrollArea` |
| AedstCollapsible | `AedstCollapsible.qml` | `Collapsible` |

### Actions
| Component | File | Web equivalent |
|---|---|---|
| AedstButton | `AedstButton.qml` | `Button` (variants: Default/Secondary/Destructive/Outline/Ghost/Link; sizes: Default/Sm/Lg/Icon; `busy` loading state) |
| AedstIconButton | `AedstIconButton.qml` | `Button size="icon"` |
| AedstToggleButton | `AedstToggleButton.qml` | `Toggle` |
| AedstToggleGroup | `AedstToggleGroup.qml` | `ToggleGroup` |

### Forms
| Component | File | Web equivalent |
|---|---|---|
| AedstTextField | `AedstTextField.qml` | `Input` + `Label` (rewritten) |
| AedstTextArea | `AedstTextArea.qml` | `Textarea` |
| AedstLabel | `AedstLabel.qml` | `Label` |
| AedstListItem | `AedstListItem.qml` | `ItemDelegate` (themed list row; raw `ItemDelegate` is forbidden in features) |
| AedstCheckBox | `AedstCheckBox.qml` | `Checkbox` (tri-state) |
| AedstSwitch | `AedstSwitch.qml` | `Switch` |
| AedstRadioButton / AedstRadioGroup | `AedstRadioButton.qml` / `AedstRadioGroup.qml` | `RadioGroup` / `RadioGroupItem` |
| AedstComboBox | `AedstComboBox.qml` | `Select` |
| AedstSearchableComboBox | `AedstSearchableComboBox.qml` | Combobox (Popover+Command) pattern |
| AedstSlider | `AedstSlider.qml` | `Slider` |
| AedstOtpInput | `AedstOtpInput.qml` | `InputOTP` |

### Feedback
| Component | File | Web equivalent |
|---|---|---|
| AedstAlert | `AedstAlert.qml` | `Alert` (Info/Success/Warning/Destructive) |
| AedstAlertDialog | `AedstAlertDialog.qml` | `AlertDialog` |
| AedstStateView | `AedstStateView.qml` | Loading / Empty / Error / Offline / Success states (`viewState` enum), accessible by default |
| AedstOfflineBanner | `AedstOfflineBanner.qml` | connectivity banner driven by `Connectivity.isOffline` |
| AedstToast | `AedstToast.qml` | `Toast`/sonner (per-instance; no global overlay manager yet, see Skipped) |
| AedstProgressBar | `AedstProgressBar.qml` | `Progress` (+ indeterminate) |
| AedstCircularProgress | `AedstCircularProgress.qml` | spinner (`Loader2`/`animate-spin`) |
| AedstSkeleton | `AedstSkeleton.qml` | `Skeleton` |
| AedstBadge | `AedstBadge.qml` | `Badge` |
| AedstToolTip | `AedstToolTip.qml` | `Tooltip` |

### Overlay / navigation
| Component | File | Web equivalent |
|---|---|---|
| AedstDialog | `AedstDialog.qml` | `Dialog` |
| AedstDrawer | `AedstDrawer.qml` | `Sheet` (`T.Drawer`, edge-anchored) |
| AedstPopover | `AedstPopover.qml` | `Popover` |
| AedstDropdownMenu | `AedstDropdownMenu.qml` | `DropdownMenu` |
| AedstContextMenu | `AedstContextMenu.qml` | `ContextMenu` (native right-click `Menu`) |
| AedstMenuBar | `AedstMenuBar.qml` | `Menubar` |
| AedstTabBar | `AedstTabBar.qml` | `Tabs` / `NavigationMenu` |
| AedstSearchableList | `AedstSearchableList.qml` | `Command` (palette) |
| AedstHoverCard | `AedstHoverCard.qml` | `HoverCard` (ToolTip-based; real hover on desktop) |

### Data display
| Component | File | Web equivalent |
|---|---|---|
| AedstAvatar | `AedstAvatar.qml` | `Avatar` (initials fallback, circular mask via `QtQuick.Effects.MultiEffect`) |
| AedstTableView | `AedstTableView.qml` | `Table` |
| AedstCalendar | `AedstCalendar.qml` | `Calendar` (`T.MonthGrid` + `T.DayOfWeekRow`: locale-aware first weekday, names and digits) |
| AedstCarousel | `AedstCarousel.qml` | `Carousel` (`T.SwipeView`-based) |
| AedstAccordion | `AedstAccordion.qml` | `Accordion` (stack of `AedstCollapsible`) |
| AedstBreadcrumb | `AedstBreadcrumb.qml` | `Breadcrumb` |
| AedstPagination | `AedstPagination.qml` | `Pagination` |
| AedstChart | `AedstChart.qml` | simple bar/line chart (`Canvas`-drawn, per the "keep it simple" instruction — no charting library) |

45 `.qml` component files total (43 new + `AedstButton`/`AedstTextField`
rewritten), plus the `Theme.qml` singleton, `qmldir`, and the
`ThemeController` native extension.

## Deliberately skipped / adapted

- **Global toast/overlay manager, `Sonner`'s queue** — `AedstToast.qml` is a
  single themed, auto-dismissing notification instance; there is no
  `OverlayManager`/singleton stacking multiple toasts yet, because this
  module has no existing app-wide overlay layer to hook into (Main.qml's
  `ApplicationWindow` has no overlay slot reserved for it). A future pass
  can add an `AedstToastHost` singleton once a call site needs it.
- **`Calendar`** — Qt Quick Controls' old `Calendar`/`CalendarModel` (Qt 5 Extras) are gone, but `MonthGrid`,
  `DayOfWeekRow` and `WeekNumberColumn` are part of Qt Quick Controls 2 in Qt 6. `AedstCalendar.qml` is built on
  `MonthGrid` + `DayOfWeekRow`, so the first weekday, weekday names and digits follow the locale (no hand-written date
  arithmetic). It has no week-number column or date range yet.
- **`Chart`** — kept to a minimal `Canvas`-drawn bar/line renderer per the
  explicit instruction not to pull in a heavy charting dependency; it does
  not attempt to match shadcn's Recharts-based `ChartContainer` feature set
  (legends, tooltips, multi-series) — only single-series bar/line.
- **`NavigationMenu`** — not built as a separate component; `AedstTabBar`
  covers both the web `Tabs` and `NavigationMenu` use cases, per the task's
  own suggested mapping.
- **`Sheet`** — mapped to `AedstDrawer.qml` (`T.Drawer`-based, edge-anchored),
  per the task's suggested mapping; there is no separate "Sheet" file.
- **Circular avatar clipping** depends on the `QtQuick.Effects` module
  (`MultiEffect` with `maskEnabled`), Qt 6.5+'s replacement for the
  deprecated `QtGraphicalEffects`/`Qt5Compat.GraphicalEffects` `OpacityMask`.
  `App/CMakeLists.txt` already links `Qt6::Quick`/`Qt6::QuickControls2`; if
  a build ever reports the `QtQuick.Effects` QML module missing, link/deploy
  that module explicitly for the app target.

## Verification

**No CMake or Qt toolchain is available in this sandbox** (`cmake` is not on
`PATH`, no `qmake`/Qt install found), so `cmake --build <dir> --target
AedstDesignSystem` could not be run. Verification instead was:

1. Read every existing file in this module (`theme_controller.hpp/.cpp`,
   `Theme.qml`, `AedstButton.qml`, `AedstTextField.qml`, `qmldir`,
   `CMakeLists.txt`) plus the two consumers (`App/qml/Main.qml`,
   `Auth/Presentation/LoginView.qml`) before writing anything, to extend the
   existing token/component pattern instead of replacing it.
2. Every new/changed `.qml` file was checked for brace balance
   (script-verified: all 45 component files + `Theme.qml` balance).
3. Grep-verified import hygiene across every file: any file using
   `ColumnLayout`/`RowLayout`/`GridLayout` imports `QtQuick.Layouts`; any
   file using the `T.*` alias imports `QtQuick.Controls.Basic as T`; any
   file using `MultiEffect` imports `QtQuick.Effects`.
4. Manually re-read each file for QML API correctness against known Qt
   Quick Controls 2 customization patterns (e.g. `ComboBox`'s
   `popup`/`delegateModel`, `MenuBar`'s `delegate` being a *style* delegate
   with `Menu` children supplying `title`, not a data-model delegate).
   Caught and fixed several bugs this way before settling on the final
   version: a self-referencing `text:` binding in `AedstLabel.qml` (infinite
   binding loop), several `T.ListView`/`T.MouseArea` references to types
   that only exist unqualified in `QtQuick` (not under the
   `QtQuick.Controls.Basic` `T` alias), and an initial `AedstMenuBar.qml`
   that mixed a data-model `delegate` with `MenuBarItem` children instead of
   following the `Menu`-per-item pattern QQC2 actually expects.
5. `ThemeController`'s new properties were checked for `Q_PROPERTY`/getter
   signature consistency (each color getter takes no arguments, returns
   `QColor`, and is wired to `NOTIFY themeChanged`; the radius/spacing scale
   is `CONSTANT` + `static`, matching the existing `spacing()`/
   `cornerRadius()` methods it replaces).

This is a solid substitute for a compiler in this sandbox, but it is not a
compiler: the next session with a working Qt 6.8 toolchain should run
`cmake --build --target AedstDesignSystem` (and ideally `qmllint` over
`qml/AedstDesignSystem/*.qml`) before this is considered fully verified.


## Conventions

- Every interactive component sets `Accessible.role`/`name`, shows a `Theme.ring` focus ring and activates on Enter/Space.
- Do not set `cursorShape` on `T.Button`/`AbstractButton` types (no such property): use a `HoverHandler` inside the background.
- Shell shortcuts: Back = Alt+Left / Esc, Sign out = Ctrl+Shift+Q, Quit = `StandardKey.Quit`, Retry = F5.
- User text goes through `qsTr` and must exist in all five catalogs (`i18n/designsystem_{en,ru,ar,tg,uz}.ts`).
