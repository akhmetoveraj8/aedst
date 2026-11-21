# aedst-ui: the Desktop UI kit (Slint)

The Slint implementation of the AEDST kit: the 60 components of [`ui-kit.yaml`](../../../../ui-kit.yaml)
(59 shadcn names plus `trace` and `code-block`; `toast` is an alias of `sonner`) and one extension,
`AedstActionRow`. Web (`apps/web/shared/ui`) is the reference for names, variants and sizes.

> **Verification status: written, not compiled.** Everything except the six original components was
> written on a machine without a Rust toolchain (2026-11-21). No `.slint` file here has been through
> the Slint compiler since, and the tests in `tests/components.rs` and `tests/navigation.rs` have never
> run. Expect compile errors on the first `cargo build`; the riskiest spots are listed under
> [Unverified](#unverified). Desktop stays a frozen platform ([status](../../../../docs/content/status.md)).

## Layout of the crate

| Path | What |
|---|---|
| `ui/lib.slint` | Entry point: features write `import { ... } from "@aedst-ui";` |
| `ui/aedst_<name>.slint` | One file per manifest entry, exporting `Aedst<Name>` and its enums and structs |
| `ui/aedst_tokens.slint` | Generated design tokens (`pnpm --dir packages/design-tokens build`); never hand-edited |
| `ui/aedst_layout.slint` | `AedstLayout.rtl`, the single right-to-left switch |
| `ui/gallery.slint`, `ui/gallery/` | The gallery window (compiled by `build.rs`, so `cargo build` type-checks every component) and its pages |
| `tests/` | Headless UI tests (`i-slint-backend-testing`) |

## Rules every component follows

- **Tokens only.** Colours, spacing, radii and type sizes come from `AedstTokens`; no colour literal
  (`task check:colors`). Tints are derived with `transparentize()` / `darker()`.
- **RTL in one place.** A component reads `AedstLayout.rtl` once (`private property <bool> rtl`) and
  mirrors itself: alignment, the side of icons and chevrons, the order of repeated items (Slint cannot
  reverse a layout, so a visual slot shows the mirrored index, see `at(slot)`), and the meaning of the
  Left/Right keys. Features never branch on `rtl`.
- **Accessibility.** Every interactive element has `accessible-role`, `accessible-label`, the state
  properties that apply (`-checked`, `-value`, `-enabled`, `-expanded`, `-item-selected`) and
  `accessible-action-default`; it is reachable by Tab and operated from the keyboard through a
  `FocusScope`, with a visible ring in `AedstTokens.ring`.
- **No `std-widgets` in features.** The kit builds on built-in elements. The one exception is
  `AedstNativeSelect`, a wrapper over the std-widgets `ComboBox` (the platform's own select).
- **No strings in the kit.** Slint bundles translations per compilation and looks them up in the
  catalogue of the crate that compiles the view, and each feature's `tests/catalogs.rs` fails on an
  entry the feature's own `.slint` file does not contain. A `@tr` inside the kit would therefore be
  untranslated and would break those tests. Every text, including accessible names such as "Close" or
  "Next month", is a property: the feature passes `@tr("" => "...")` from its own catalogue. The kit
  has no `.po` files.
- **Data in, callbacks out.** Slint has one children slot, no string search and no way to fold or split
  an array, so list-like components take a model (`[string]`, `[AedstMenuItem]`, ...) and the caller
  does the filtering, sorting, date formatting and line splitting in Rust.

### Enums

Variants and sizes are exported enums with the manifest spellings, for example
`AedstButtonVariant { default, outline, secondary, ghost, destructive, link }`. `default` is a legal
Slint enum value (the built-in `MouseCursor.default` uses it), so no spelling was changed.
**Always write the value qualified** (`AedstButtonSize.icon`, not `icon`): Slint resolves a bare name
to a property of an element in scope before it tries enum values, and `icon`, `text`, `size` are
property names.

Where the manifest merges two web `cva` definitions into one list, the kit keeps them apart:

| Manifest entry | Enums |
|---|---|
| `item` (`default, outline, muted, icon, image`) | `AedstItemVariant { default, outline, muted }`, `AedstItemMediaVariant { default, icon, image }`, `AedstItemSize` |
| `empty` (`default, icon`) | `AedstEmptyVariant` (how the media is framed) |
| `sidebar` | `AedstSidebarVariant`, `AedstSidebarSize` (the menu entries) |
| `input-group` | `AedstInputGroupAlign` (axis `align`), `AedstInputGroupButtonSize` |
| `tabs` | `AedstTabsVariant` (the tab list) |
| axes | `AedstButtonGroupOrientation`, `AedstFieldOrientation`, `AedstTraceStatus` |

### State

Leaf two-state controls are **controlled**, like the original `AedstCheckbox`: `AedstSwitch` and
`AedstToggle` take `in property <bool> checked` and ask for a change with `toggled(value)`.
Controls with a position keep it themselves in an `in-out` property and report it
(`current-index` + `selected(index)`, `value` + `value-changed`, `open` + `closed`, `page` +
`page-changed`); bind it two-way (`<=>`) to keep the state outside.

### Overlays

`AedstDialog`, `AedstAlertDialog`, `AedstSheet`, `AedstDrawer` and `AedstSonner` are drawn inside the
window: place them as the **last child of the view's root element**, not inside a layout.
`AedstDropdownMenu`, `AedstSelect`, `AedstCombobox`, `AedstDatePicker`, `AedstContextMenu`,
`AedstMenubar`, `AedstNavigationMenu`, `AedstTooltip`, `AedstHoverCard` and `AedstPopover` use
`PopupWindow`.

## Components

`name` is the manifest entry; the file is `ui/aedst_<name with underscores>.slint`.

| name | Component | Variants / sizes | Notes |
|---|---|---|---|
| accordion | `AedstAccordion` | - | `[AedstAccordionItem]`, one section open |
| alert | `AedstAlert` | `AedstAlertVariant` | |
| alert-dialog | `AedstAlertDialog` | - | built on `AedstDialog` and `AedstActionRow` |
| aspect-ratio | `AedstAspectRatio` | - | |
| avatar | `AedstAvatar` | - | image or initials |
| badge | `AedstBadge` | `AedstBadgeVariant` | replaced the `tone` string |
| breadcrumb | `AedstBreadcrumb` | - | |
| button | `AedstButton` | `AedstButtonVariant`, `AedstButtonSize` | replaced `primary: bool`; heights 24/28/32/36px as on web |
| button-group | `AedstButtonGroup` | axis `AedstButtonGroupOrientation` | |
| calendar | `AedstCalendar` | - | Gregorian month grid; names from the caller |
| card | `AedstCard` | - | |
| carousel | `AedstCarousel` | - | slides are the children |
| chart | `AedstChart` | - | one series, `AedstChartKind { bar, line }` |
| checkbox | `AedstCheckbox` | - | unchanged |
| code-block | `AedstCodeBlock` | - | `[AedstCodeLine]`; no highlighter |
| collapsible | `AedstCollapsible` | - | also exports `AedstCollapsibleTrigger` |
| combobox | `AedstCombobox` | - | the caller filters |
| command | `AedstCommand` | - | the caller filters |
| context-menu | `AedstContextMenu` | - | |
| data-table | `AedstDataTable` | - | the caller sorts and pages |
| date-picker | `AedstDatePicker` | - | `AedstCalendar` in a popup; the caller formats the date |
| dialog | `AedstDialog` | - | |
| drawer | `AedstDrawer` | - | `AedstSheet` at the bottom with a handle |
| dropdown-menu | `AedstDropdownMenu` | - | also exports `AedstMenuItem`, `AedstMenuList`, `AedstMenuRow` |
| empty | `AedstEmpty` | `AedstEmptyVariant` | |
| field | `AedstField` | axis `AedstFieldOrientation` | |
| form | `AedstForm` | - | layout and form-level error; validation stays in `presentation` |
| hover-card | `AedstHoverCard` | - | card content is title and description |
| input | `AedstInput` | - | **renamed** from `AedstTextField` (`aedst_text_field.slint`) |
| input-group | `AedstInputGroup` | `AedstInputGroupButtonSize`, axis `AedstInputGroupAlign` | |
| input-otp | `AedstInputOtp` | - | up to 8 characters; no paste |
| item | `AedstItem` | `AedstItemVariant`, `AedstItemMediaVariant`, `AedstItemSize` | |
| kbd | `AedstKbd` | - | |
| label | `AedstLabel` | - | unchanged |
| menubar | `AedstMenubar` | - | `[AedstMenubarMenu]` |
| native-select | `AedstNativeSelect` | - | std-widgets `ComboBox`, native look |
| navigation-menu | `AedstNavigationMenu` | - | `[AedstNavigationItem]` |
| pagination | `AedstPagination` | - | |
| popover | `AedstPopover` | - | inherits `PopupWindow` |
| progress | `AedstProgress` | - | |
| radio-group | `AedstRadioGroup` | - | |
| resizable | `AedstResizable` | - | one panel with a drag handle |
| scroll-area | `AedstScrollArea` | - | `Flickable` with a token scrollbar (manifest: `native`) |
| select | `AedstSelect` | - | |
| separator | `AedstSeparator` | - | |
| sheet | `AedstSheet` | - | `AedstSheetSide { top, right, bottom, left }` |
| sidebar | `AedstSidebar` | `AedstSidebarVariant`, `AedstSidebarSize` | `[AedstSidebarItem]`, collapses to a rail |
| skeleton | `AedstSkeleton` | - | |
| slider | `AedstSlider` | - | |
| sonner | `AedstSonner` | - | toast stack, `[AedstToast]` |
| spinner | `AedstSpinner` | - | |
| switch | `AedstSwitch` | - | |
| table | `AedstTable` | - | |
| tabs | `AedstTabs` | `AedstTabsVariant` | |
| textarea | `AedstTextarea` | - | built-in multi-line `TextInput` |
| toggle | `AedstToggle` | `AedstToggleVariant`, `AedstToggleSize` | |
| toggle-group | `AedstToggleGroup` | - | single or multiple |
| tooltip | `AedstTooltip` | - | |
| trace | `AedstTrace` | axis `AedstTraceStatus` | `[AedstTraceStep]`, flattened by the caller |
| typography | `AedstTypography` | `AedstTypographyVariant` | |

Extension: `AedstActionRow` (`ui/aedst_action_row.slint`).

## Known gaps

- No focus trap: with a dialog or sheet open, Tab can still reach controls under the scrim.
- `AedstTooltip` and `AedstHoverCard` are pointer-only; give the control an accessible description too.
- `AedstInputOtp` has no paste; `AedstCarousel` keeps the physical slide order in RTL; the
  `AedstScrollArea` scrollbar is not draggable; `AedstDrawer` cannot be dragged.
- `AedstMenuList` skips one disabled entry per key press, not a run of them.
- No font-family token: `AedstCodeBlock` and `AedstTypography` (`inline-code`) ask for `"monospace"`.
- Icons are `image` properties or text glyphs; there is no icon set for Desktop yet.

## Unverified

Nothing here was compiled. The constructs most likely to need a fix on the first build:

- `key-pressed` on the built-in `TextInput` (`AedstCommand`), `changed <property>` handlers,
  `init` + `focus()` inside a `PopupWindow`, `@children` inside a component that inherits `PopupWindow`.
- Whether a `PopupWindow` with `no-auto-close` keeps the hover of the element under it (tooltip, hover card).
- Whether `visible: false` removes the hidden gallery pages and closed overlays from Tab order.
- `AccessibleRole.radio-button`, `accessible-item-*` and `accessible-expand*` against Slint 1.19.0
  (taken from the current reference at docs.slint.dev, which may describe a newer release).
- Copying through a hidden, disabled `TextInput` (`AedstCodeBlock`).

## Gallery and tests

`cargo run -p aedst-ui --example gallery -- [--rtl] [--dark] [--page <0..4>]` (0 basics, 1 forms,
2 display, 3 navigation, 4 overlays). `tests/ui.rs` covers the original components;
`tests/components.rs` and `tests/navigation.rs` cover the new ones through accessible actions and key
presses (popups are not covered).
