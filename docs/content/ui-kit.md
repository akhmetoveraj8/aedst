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
Web components are the reference for behavior, naming, variants and sizes
(recorded in `ui-kit.yaml`), but web is **not** the source of truth for token
values: those live in `packages/design-tokens`.

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

## The rule

The UI kit is the current shadcn/ui component set (59 names) plus two AEDST
components, `trace` (a collapsible step tree for agent and tool execution
traces) and `code-block`: **61 components, the same on every platform**.

1. **Names follow shadcn on every platform.** The canonical name is the
   kebab-case shadcn name (`alert-dialog`, `date-picker`); each platform spells
   it in its own convention (`AedstAlertDialog`, `aedst_alert_dialog.slint`).
2. **Variants and sizes come from [`ui-kit.yaml`](../../ui-kit.yaml).** The
   manifest takes them from the web implementation (the reference) and the gate
   compares them with the `cva` definitions in `apps/web/shared/ui`, both ways.
   A native kit implements the same variant and size names, and the gate
   compares them with the enums of the component file: Kotlin enum constants,
   Swift enum cases, exported Slint enums. An enum whose name ends with the
   axis name supplies that axis (`AedstButtonVariant`, `AedstButtonSize`,
   `AedstFieldOrientation`); names compare case-insensitively with separators
   ignored, so `icon-sm`, `ICON_SM` and `iconSm` are the same name. A platform
   that differs on purpose records it in the manifest under the entry's
   `deviations:` key (`<platform>: { <axis>: { values, reason } }`); the reason
   is mandatory and the listed values are checked against the file.
3. **A new component lands in the manifest first**, then on web, then on the
   other platforms. A kit file that the manifest does not list fails the gate,
   on every platform.
4. A kit file outside the canonical set is an **extension** (listed per
   platform under `extensions:`); it is not part of the parity count.

`toast` is an alias of `sonner`: Sonner is the only toast on web (Biome bans
`@/shared/ui/toast`, see [Library-First: Web](/library-first/web)), so the
shadcn `toast` name is served by the `sonner` entry on every platform.

Gate: `task check:ui-kit` (`node scripts/check-ui-kit.mjs`, in `task check` and
in the `policies-ci` workflow). It fails when an entry marked `implemented` has
no file, when an undeclared kit file exists, when an entry is `missing` on any
platform, when a declared variant or size differs from the web `cva` definition
or from the enums of an Android, Apple or Desktop kit file without a recorded
deviation, when a web component has no story, or when the matrix below is out
of date. Every platform now covers all 61 entries, so the earlier allowance for
`missing` on the frozen platforms is gone; `native` stays for an entry the
platform SDK provides (two on Android: `aspect-ratio`, `scroll-area`). The
parity report is printed on every run.

## Component parity matrix

Generated from `ui-kit.yaml`; do not edit the block by hand. Regenerate with
`node scripts/check-ui-kit.mjs --write-docs`.

Legend: **yes** = a component file exists (its name in the cell); **native** =
the platform SDK provides it and the kit adds nothing; **missing** = not
implemented. "yes" is a statement about the file tree only; what a compiler has
seen is listed under [Verification](#verification). The last table lists the
recorded deviations of a native kit from the canonical variants and sizes.

<!-- ui-kit:matrix:start (generated from ui-kit.yaml by `node scripts/check-ui-kit.mjs --write-docs`; do not edit) -->

| Platform | Implemented | Native | Missing | Of |
|---|---|---|---|---|
| Web | 61 | 0 | 0 | 61 |
| Android | 59 | 2 | 0 | 61 |
| Apple | 61 | 0 | 0 | 61 |
| Desktop | 61 | 0 | 0 | 61 |

| Component | Variants | Sizes | Web | Android | Apple | Desktop |
|---|---|---|---|---|---|---|
| `accordion` | - | - | yes (`accordion`) | yes (`AedstAccordion`) | yes (`AedstAccordion`) | yes (`aedst_accordion`) |
| `alert` | `default`, `destructive` | - | yes (`alert`) | yes (`AedstAlert`) | yes (`AedstAlert`) | yes (`aedst_alert`) |
| `alert-dialog` | - | - | yes (`alert-dialog`) | yes (`AedstAlertDialog`) | yes (`AedstAlertDialog`) | yes (`aedst_alert_dialog`) |
| `aspect-ratio` | - | - | yes (`aspect-ratio`) | native (Modifier.aspectRatio) | yes (`AedstAspectRatio`) | yes (`aedst_aspect_ratio`) |
| `avatar` | - | - | yes (`avatar`) | yes (`AedstAvatar`) | yes (`AedstAvatar`) | yes (`aedst_avatar`) |
| `badge` | `default`, `secondary`, `destructive`, `success`, `warning`, `info`, `outline`, `ghost`, `link` | - | yes (`badge`) | yes (`AedstBadge`) | yes (`AedstBadge`) | yes (`aedst_badge`) |
| `breadcrumb` | - | - | yes (`breadcrumb`) | yes (`AedstBreadcrumb`) | yes (`AedstBreadcrumb`) | yes (`aedst_breadcrumb`) |
| `button` | `default`, `outline`, `secondary`, `ghost`, `destructive`, `link` | `default`, `xs`, `sm`, `lg`, `icon`, `icon-xs`, `icon-sm`, `icon-lg` | yes (`button`) | yes (`AedstButton`) | yes (`AedstButton`) | yes (`aedst_button`) |
| `button-group` | - | - | yes (`button-group`) | yes (`AedstButtonGroup`) | yes (`AedstButtonGroup`) | yes (`aedst_button_group`) |
| `calendar` | - | - | yes (`calendar`) | yes (`AedstCalendar`) | yes (`AedstCalendar`) | yes (`aedst_calendar`) |
| `card` | - | - | yes (`card`) | yes (`AedstCard`) | yes (`AedstCard`) | yes (`aedst_card`) |
| `carousel` | - | - | yes (`carousel`) | yes (`AedstCarousel`) | yes (`AedstCarousel`) | yes (`aedst_carousel`) |
| `chart` | - | - | yes (`chart`) | yes (`AedstChart`) | yes (`AedstChart`) | yes (`aedst_chart`) |
| `checkbox` | - | - | yes (`checkbox`) | yes (`AedstCheckbox`) | yes (`AedstCheckbox`) | yes (`aedst_checkbox`) |
| `collapsible` | - | - | yes (`collapsible`) | yes (`AedstCollapsible`) | yes (`AedstCollapsible`) | yes (`aedst_collapsible`) |
| `combobox` | - | - | yes (`combobox`) | yes (`AedstCombobox`) | yes (`AedstCombobox`) | yes (`aedst_combobox`) |
| `command` | - | - | yes (`command`) | yes (`AedstCommand`) | yes (`AedstCommand`) | yes (`aedst_command`) |
| `context-menu` | - | - | yes (`context-menu`) | yes (`AedstContextMenu`) | yes (`AedstContextMenu`) | yes (`aedst_context_menu`) |
| `data-table` | - | - | yes (`data-table`) | yes (`AedstDataTable`) | yes (`AedstDataTable`) | yes (`aedst_data_table`) |
| `date-picker` | - | - | yes (`date-picker`) | yes (`AedstDatePicker`) | yes (`AedstDatePicker`) | yes (`aedst_date_picker`) |
| `dialog` | - | - | yes (`dialog`) | yes (`AedstDialog`) | yes (`AedstDialog`) | yes (`aedst_dialog`) |
| `drawer` | - | - | yes (`drawer`) | yes (`AedstBottomSheet`) | yes (`AedstDrawer`) | yes (`aedst_drawer`) |
| `dropdown-menu` | - | - | yes (`dropdown-menu`) | yes (`AedstDropdownMenu`) | yes (`AedstDropdownMenu`) | yes (`aedst_dropdown_menu`) |
| `empty` | `default`, `icon` | - | yes (`empty`) | yes (`AedstEmpty`) | yes (`AedstEmpty`) | yes (`aedst_empty`) |
| `field` | - | - | yes (`field`) | yes (`AedstField`) | yes (`AedstField`) | yes (`aedst_field`) |
| `form` | - | - | yes (`form`) | yes (`AedstForm`) | yes (`AedstForm`) | yes (`aedst_form`) |
| `hover-card` | - | - | yes (`hover-card`) | yes (`AedstHoverCard`) | yes (`AedstHoverCard`) | yes (`aedst_hover_card`) |
| `input` | - | - | yes (`input`) | yes (`AedstTextField`) | yes (`AedstTextField`) | yes (`aedst_input`) |
| `input-group` | - | `xs`, `sm`, `icon-xs`, `icon-sm` | yes (`input-group`) | yes (`AedstInputGroup`) | yes (`AedstInputGroup`) | yes (`aedst_input_group`) |
| `input-otp` | - | - | yes (`input-otp`) | yes (`AedstInputOtp`) | yes (`AedstInputOTP`) | yes (`aedst_input_otp`) |
| `item` | `default`, `outline`, `muted`, `icon`, `image` | `default`, `sm`, `xs` | yes (`item`) | yes (`AedstItem`) | yes (`AedstItem`) | yes (`aedst_item`) |
| `kbd` | - | - | yes (`kbd`) | yes (`AedstKbd`) | yes (`AedstKbd`) | yes (`aedst_kbd`) |
| `label` | - | - | yes (`label`) | yes (`AedstLabel`) | yes (`AedstLabel`) | yes (`aedst_label`) |
| `menubar` | - | - | yes (`menubar`) | yes (`AedstMenubar`) | yes (`AedstMenubar`) | yes (`aedst_menubar`) |
| `native-select` | - | - | yes (`native-select`) | yes (`AedstNativeSelect`) | yes (`AedstNativeSelect`) | yes (`aedst_native_select`) |
| `navigation-menu` | - | - | yes (`navigation-menu`) | yes (`AedstNavigationMenu`) | yes (`AedstNavigationMenu`) | yes (`aedst_navigation_menu`) |
| `pagination` | - | - | yes (`pagination`) | yes (`AedstPagination`) | yes (`AedstPagination`) | yes (`aedst_pagination`) |
| `popover` | - | - | yes (`popover`) | yes (`AedstPopover`) | yes (`AedstPopover`) | yes (`aedst_popover`) |
| `progress` | - | - | yes (`progress`) | yes (`AedstProgressIndicator`) | yes (`AedstProgressView`) | yes (`aedst_progress`) |
| `radio-group` | - | - | yes (`radio-group`) | yes (`AedstRadioGroup`) | yes (`AedstRadioGroup`) | yes (`aedst_radio_group`) |
| `resizable` | - | - | yes (`resizable`) | yes (`AedstResizable`) | yes (`AedstResizable`) | yes (`aedst_resizable`) |
| `scroll-area` | - | - | yes (`scroll-area`) | native (Compose scroll modifiers and lazy lists) | yes (`AedstScrollArea`) | yes (`aedst_scroll_area`) |
| `select` | - | - | yes (`select`) | yes (`AedstSelect`) | yes (`AedstSelect`) | yes (`aedst_select`) |
| `separator` | - | - | yes (`separator`) | yes (`AedstDivider`) | yes (`AedstSeparator`) | yes (`aedst_separator`) |
| `sheet` | - | - | yes (`sheet`) | yes (`AedstSheet`) | yes (`AedstSheet`) | yes (`aedst_sheet`) |
| `sidebar` | `default`, `outline` | `default`, `sm`, `lg` | yes (`sidebar`) | yes (`AedstSidebar`) | yes (`AedstSidebar`) | yes (`aedst_sidebar`) |
| `skeleton` | - | - | yes (`skeleton`) | yes (`AedstSkeleton`) | yes (`AedstSkeleton`) | yes (`aedst_skeleton`) |
| `slider` | - | - | yes (`slider`) | yes (`AedstSlider`) | yes (`AedstSlider`) | yes (`aedst_slider`) |
| `sonner` | - | - | yes (`sonner`) | yes (`AedstSnackbar`) | yes (`AedstToast`) | yes (`aedst_sonner`) |
| `spinner` | - | - | yes (`spinner`) | yes (`AedstSpinner`) | yes (`AedstSpinner`) | yes (`aedst_spinner`) |
| `switch` | - | - | yes (`switch`) | yes (`AedstSwitch`) | yes (`AedstSwitch`) | yes (`aedst_switch`) |
| `table` | - | - | yes (`table`) | yes (`AedstTable`) | yes (`AedstTable`) | yes (`aedst_table`) |
| `tabs` | `default`, `line` | - | yes (`tabs`) | yes (`AedstTabs`) | yes (`AedstTabs`) | yes (`aedst_tabs`) |
| `textarea` | - | - | yes (`textarea`) | yes (`AedstTextArea`) | yes (`AedstTextarea`) | yes (`aedst_textarea`) |
| `toast` | alias of `sonner` | - | see `sonner` | see `sonner` | see `sonner` | see `sonner` |
| `toggle` | `default`, `outline` | `default`, `sm`, `lg` | yes (`toggle`) | yes (`AedstToggle`) | yes (`AedstToggle`) | yes (`aedst_toggle`) |
| `toggle-group` | - | - | yes (`toggle-group`) | yes (`AedstToggleGroup`) | yes (`AedstToggleGroup`) | yes (`aedst_toggle_group`) |
| `tooltip` | - | - | yes (`tooltip`) | yes (`AedstTooltip`) | yes (`AedstTooltip`) | yes (`aedst_tooltip`) |
| `typography` | `h1`, `h2`, `h3`, `h4`, `p`, `blockquote`, `list`, `inline-code`, `lead`, `large`, `small`, `muted` | - | yes (`typography`) | yes (`AedstTypography`) | yes (`AedstText`) | yes (`aedst_typography`) |
| `trace` | - | - | yes (`trace`) | yes (`AedstTrace`) | yes (`AedstTrace`) | yes (`aedst_trace`) |
| `code-block` | - | - | yes (`code-block`) | yes (`AedstCodeBlock`) | yes (`AedstCodeBlock`) | yes (`aedst_code_block`) |

| Platform | Extensions (outside the canonical set) |
|---|---|
| Web | `attachment`, `bubble`, `direction`, `loading-skeleton`, `locale-select`, `marker`, `message`, `message-scroller`, `mode-toggle`, `questionnaire` |
| Android | `AedstCountBadge`, `AedstFab`, `AedstFilterChip`, `AedstIconButton`, `AedstOfflineBanner`, `AedstTopAppBar`, `ErrorMessages`, `LoadingIndicator` |
| Apple | `AedstErrorPresenter`, `AedstIconButton` |
| Desktop | `aedst_action_row` |

| Component | Platform | Axis | Platform values | Reason for the deviation |
|---|---|---|---|---|
| `avatar` | Android | size | `sm`, `md`, `lg` | web has no cva size axis (data-size prop: default, sm, lg); the Compose kit exposes it as AedstAvatarSize and names the default size md |
| `avatar` | Apple | size | `sm`, `md`, `lg` | web has no cva size axis (data-size prop: default, sm, lg); the SwiftUI kit exposes it as AedstAvatarSize and names the default size md |

<!-- ui-kit:matrix:end -->

Notes:

- The full set was written on Android, Apple and Desktop on 2026-11-21 under the
  owner exception recorded in [Platform status](/status). Before that the kits
  had 23, 16 and 5 of the 61 entries.
- Some platform files keep the platform's own word for a component: Android
  `AedstBottomSheet` (`drawer`), `AedstDivider` (`separator`), `AedstSnackbar`
  (`sonner`), `AedstProgressIndicator` (`progress`), `AedstTextField` (`input`);
  Apple `AedstText` (`typography`; `AedstTypography` is the font token scale),
  `AedstTextField` (`input`), `AedstProgressView` (`progress`), `AedstToast`
  (`sonner`). The manifest maps each one.
- Android: `aspect-ratio` and `scroll-area` are `native` (`Modifier.aspectRatio`;
  scroll modifiers and lazy lists). `AedstAlertAccent` (`NONE`, `WARNING`) is an
  Android extension of `alert` outside the canonical variants.
- Desktop (Rust + Slint, `apps/desktop/crates/aedst-ui/ui/`): one
  `aedst_<name>.slint` file per entry; `input` is `aedst_input.slint` (it was
  `aedst_text_field.slint`); helper exports share the file of their component
  (menu items live in `aedst_dropdown_menu.slint`); `aedst_action_row` is an
  extension; the gallery (`gallery.slint`, `ui/gallery/`) is not a component.
- The only variant or size difference the gate found is `avatar`: web takes its
  size as a `data-size` prop (`default`, `sm`, `lg`) outside `cva`, so the
  manifest has no canonical size list; Android and Apple expose `sm`, `md`, `lg`
  as an enum. It is recorded as a deviation; the kit READMEs do not explain the
  `md` name, so aligning it with web's `default` is an open question.
- Web has a Storybook 10 story for every `apps/web/shared/ui` component, with
  an a11y gate; see [decisions](/decisions/web). `code-block` ships without a
  syntax highlighter: it has a `highlight` render prop, and the choice of a
  highlighter library is an open decision (none is approved for web yet).
- `data-table` is built on TanStack Table, `date-picker` composes `calendar`
  and `popover`, `sonner` wraps the `sonner` package's `Toaster`.

## Full detail per platform

- [`apps/android/core/ui/README.md`](../../apps/android/core/ui/README.md): Compose components, adaptation rationale, verification status.
- [`apps/android/core/ui-tv/README.md`](../../apps/android/core/ui-tv/README.md): TV-only Compose surface (`:core:ui-tv`).
- [`apps/apple/Core/AedstDesignSystem/README.md`](../../apps/apple/Core/AedstDesignSystem/README.md): SwiftUI components, HIG adaptation rationale.
- [`apps/desktop/crates/aedst-ui/README.md`](../../apps/desktop/crates/aedst-ui/README.md): Slint components, the gallery, the list of unverified constructs.

## Verification

| Platform | What has been run |
|---|---|
| Web | Verified: typecheck, lint, unit and browser tests, a story per component |
| Android | `core/ui` compiled and unit-tested on the authoring machine; never run on a device or emulator, no green CI run |
| Apple | Written, not compiled (no Swift toolchain on the authoring machine) |
| Desktop | Written, not compiled (no Rust toolchain on the authoring machine; the Slint compiler has not seen the new files) |

The gate on this page reads file names and enum declarations only; it does not
compile anything. Android, Apple and Desktop stay frozen platforms; see
[Platform status](/status) for what has actually been run.
