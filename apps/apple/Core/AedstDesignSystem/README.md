# AedstDesignSystem

SwiftUI design system for `apps/apple`: tokens shared with the other platforms plus a small
component kit. Everything lives under `Sources/AedstDesignSystem/`.

## Tokens

Design tokens are **generated** from `packages/design-tokens/tokens` (single source for all platforms; see that README). Files marked GENERATED must not be edited — change the JSON and run `pnpm --dir packages/design-tokens build`.

| File | Contents |
|---|---|
| `AedstLightPalette.swift`, `AedstDarkPalette.swift` | GENERATED. Raw light/dark `Color` values per semantic token (web-parity names). The only place color literals are allowed (`scripts/check-color-literals.sh`). |
| `AedstColor.swift` | Hand-written pairing of the two palettes into adaptive light/dark `Color`s (`AedstColor.background`, `.primary`, `.success`, `.warning`, `.info`, ..., `chartSeries`). Legacy names (`brandPrimary`, `surface`, `textPrimary`, `textSecondary`, `danger`) stay as `@available(*, deprecated)` aliases. |
| `AedstSpacing.swift` | GENERATED. `CGFloat` scale `none`, `xxs`..`giant` (4pt grid; note `md` is 12, not the pre-token 16). |
| `AedstRadius.swift` | GENERATED. `CGFloat` scale `xs`..`xxxl`, `full`. |
| `AedstElevation.swift` | GENERATED. `CGFloat` elevation levels (reference values). |
| `AedstMotion.swift` | GENERATED. Animation durations in seconds. |
| `AedstTypeScale.swift` | GENERATED. Cross-platform type scale (reference values). Apple text deliberately uses Dynamic Type via `AedstTypography` instead. |
| `AedstTypography.swift` | Semantic `Font` scale on Dynamic-Type text styles: `largeTitle`, `title`, `headline`, `body`, `caption`. |

## Components (`Components/`)

The kit is deliberately small: what the app and the feature packages use, plus the few
primitives any feature of the template needs. The other shadcn/ui-parity components
(accordion, aspect ratio, breadcrumb, carousel, chart, collapsible, combobox, command palette,
context menu, date picker, dialog, drawer, dropdown menu, hover card, menu bar, navigation
container, OTP input, pagination, popover, scroll area, select, slider, tab bar, table, tabs,
text editor, toggle button, toggle group, tooltip) were removed because nothing used them.
Bring one back from git history together with its first real use, not ahead of it.

**Layout** — `AedstCard`, `AedstSeparator`

**Actions** — `AedstButton` (variants `primary/secondary/destructive/outline/ghost/link`, sizes `sm/md/lg/icon`, loading + disabled states), `AedstIconButton`

**Forms** — `AedstTextField` (placeholder, helper/error text, disabled), `AedstLabel`, `AedstCheckbox`, `AedstSwitch`, `AedstRadioGroup`

**Feedback** — `AedstAlert`, `AedstAlertDialogModifier` (`.aedstAlertDialog()`), `AedstToastModifier` (`.aedstToast()`), `AedstProgressView`, `AedstSkeleton`, `AedstBadge`, `AedstErrorPresenter` (`.aedstErrorPresenter()`)

**Overlay** — `AedstSheetModifier` / `AedstItemSheetModifier` (`.aedstSheet(isPresented:)` and `.aedstSheet(item:)`, native `.sheet()` wrappers; Features must use these, never a raw `.sheet`)

**Data display** — `AedstAvatar` now lives in `Core/AedstMedia` (remote images go through Nuke only there)

Every component has a `#Preview` and accessibility labels/hints/values on interactive
elements. Typography always goes through `AedstTypography`/`.font()` on top of
Dynamic-Type-aware `Font.system(...)` text styles, with no hardcoded point sizes. Colors come
only from `AedstColor`.

## Deliberate adaptations (web concept → SwiftUI/HIG equivalent)

- **Sheet** → native `.sheet()` wrapper (`AedstSheetModifier`), not a custom overlay.
- **AlertDialog** → wraps the native `.alert()` (`AedstAlertDialogModifier`).
- **Checkbox** / **RadioGroup** → hand-built (`RoundedRectangle`+checkmark / `Circle`+dot), since neither has a native SwiftUI control on iOS.
- **Skeleton** → hand-built shimmer (`LinearGradient` sweep over a muted block), since SwiftUI has no native placeholder-loading view.
- **Toast** → hand-built overlay + auto-dismiss `ViewModifier`, since SwiftUI has no native toast/snackbar.

## Tests

- `AedstStringsTests`, `AedstSpacingTests`: catalog and token sanity.
- `Snapshots/`: pixel snapshots on iPhone, iPad, macOS, light/dark, large Dynamic Type and RTL.
  **No reference images exist yet**, see `Tests/AedstDesignSystemTests/Snapshots/README.md`.

## Verification

Written in a sandbox with no Swift toolchain. Nothing in this package was compiled or run
there; the first real `swift build` / `xcodebuild test` on a Mac is its acceptance test.
Platform minimums are iOS 18 / macOS 15 (watchOS 11 / tvOS 18 / visionOS 2 are scaffolded only);
every SwiftUI API used is available at those floors.
