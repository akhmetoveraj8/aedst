# aedst-ui: the Desktop UI kit (Slint)

The Slint implementation of the AEDST kit: the 66 components of [`ui-kit.yaml`](../../../../ui-kit.yaml)
(shadcn names plus `trace` and `code-block`; manifest name `toast` is `AedstToaster`) and one extension,
`AedstActionRow`. The 21 AI Elements (`ai-*`) were added on 2026-11-26, also without a toolchain. Web (`apps/web/shared/ui`) is the
reference for names, variants and sizes.

> **Verification status: written, not compiled.** Everything except the six original components was
> written on a machine without a Rust toolchain (2026-11-21). No `.slint` file here has been through
> the Slint compiler since, and the tests in `tests/components.rs`, `tests/navigation.rs` and
> `tests/messages.rs` have never run. The six conversation components (attachment, bubble, marker,
> message, message-scroller, questionnaire), the size axes, drawer dragging and `src/highlight.rs`
> (syntect) were added on 2026-11-26, also without a toolchain; `Cargo.lock` was not regenerated.
> Expect compile errors on the first `cargo build`; the riskiest spots are listed under
> [Unverified](#unverified). Desktop stays a frozen platform ([status](../../../../docs/content/status.md)).

## Layout of the crate

| Path | What |
|---|---|
| `ui/lib.slint` | Entry point: features write `import { ... } from "@aedst-ui";` |
| `ui/aedst_<name>.slint` | One file per manifest entry, exporting `Aedst<Name>` and its enums and structs |
| `ui/aedst_tokens.slint` | Generated design tokens (`pnpm --dir packages/design-tokens build`); never hand-edited |
| `ui/aedst_layout.slint` | `AedstLayout.rtl`, the single right-to-left switch |
| `ui/internal/` | Helper components that are not kit entries (`questionnaire_choice.slint`) |
| `src/highlight.rs` | Syntax highlighting for `AedstCodeBlock` (syntect, scopes mapped to the seven syntax tokens) |
| `src/stack_trace.rs`, `src/test_results.rs` | `parse_stack_trace` for `AedstAiStackTrace`, `count_tests` for `AedstAiTestResults` (ports of the web helpers, unit-tested) |
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
- **No `std-widgets` in features.** The kit builds on built-in elements. Exceptions:
  `AedstNativeSelect`, a wrapper over the std-widgets `ComboBox` (the platform's own select), and
  `AedstMessageScroller` and `AedstAiChat`, built on `ListView`, the only Slint element that
  creates rows lazily.
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
| `field` (`legend, label`) | `AedstFieldLegendVariant` on `AedstFieldSet` (the legend of a group of fields) |
| `dropdown-menu` (`default, destructive`) | `AedstMenuItemVariant`, the `variant` field of `AedstMenuItem` (shared by every menu list) |
| axes | `AedstButtonGroupOrientation`, `AedstFieldOrientation`, `AedstTraceStatus`, `AedstAttachmentOrientation`, `AedstBubbleSide`, `AedstBubbleAlign`, `AedstMessageAlign` |

### State

Leaf two-state controls are **controlled**, like the original `AedstCheckbox`: `AedstSwitch` and
`AedstToggle` take `in property <bool> checked` and ask for a change with `toggled(value)`.
Controls with a position keep it themselves in an `in-out` property and report it
(`current-index` + `selected(index)`, `value` + `value-changed`, `open` + `closed`, `page` +
`page-changed`); bind it two-way (`<=>`) to keep the state outside.

### Overlays

`AedstDialog`, `AedstAlertDialog`, `AedstSheet`, `AedstDrawer` and `AedstToaster` are drawn inside the
window: place them as the **last child of the view's root element**, not inside a layout.
`AedstDropdownMenu`, `AedstSelect`, `AedstCombobox`, `AedstDatePicker`, `AedstContextMenu`,
`AedstMenubar`, `AedstNavigationMenu`, `AedstTooltip`, `AedstHoverCard` and `AedstPopover` use
`PopupWindow`.

## Components

`name` is the manifest entry; the file is `ui/aedst_<name with underscores>.slint`.

| name | Component | Variants / sizes | Notes |
|---|---|---|---|
| accordion | `AedstAccordion` | - | `[AedstAccordionItem]`, one section open |
| ai-chain-of-thought | `AedstAiChainOfThought`, `...Header`, `...Content`, `...Step`, `...Steps`, `...SearchResults`, `...Image` | - | owns the line parts every batch A element uses; `[AedstAiStep]`; `show-status` + `AedstTraceStatus` stand for web's optional status; `status-label` joins the accessible label; children are the content; SearchResults/Image live in `ui/internal/ai_chain_of_thought_media.slint` (size) |
| ai-chat | `AedstAiChat` | - | `[AedstAiChatItem]` of AedstAiMessage rows on a `ListView` (third std-widgets use: AedstMessageScroller rows are fixed), same stick-to-bottom and jump button; empty state; `busy` + `busy-label` as accessible description (no live regions) |
| ai-checkpoint | `AedstAiCheckpoint` | - | separator rules + AedstMarker + outline xs Restore in AedstTooltip; `restore()` |
| ai-confirmation | `AedstAiConfirmation` | - | `AedstAiConfirmationState`; outline sm AedstItem, Deny/Approve, `responded(bool)`; the feature sets `visible` |
| ai-context | `AedstAiContext` | - | `ratio` plus strings formatted in Rust (`percent-text`, `used-text`, `[AedstAiContextUsageRow]`); the card is an AedstPopover opened by the button (not on hover) |
| ai-file-tree | `AedstAiFileTree` | - | `[AedstAiFileTreeNode]` flattened by the caller (visible rows only; rebuild on `toggled(path, open)`), `selected-path` + `selected(path)` |
| ai-inline-citation | `AedstAiInlineCitation` | - | `[AedstAiCitationSource]` (`host` computed in Rust); trigger after the text block (no inline flow); `opened(url)` |
| ai-message | `AedstAiMessage`, `AedstAiMessageResponse`, `AedstAiMessageActions` | - | `AedstAiMessageRole`, `[AedstAiMessageAction]` (toggle = AedstToggle); plain text, no markdown renderer |
| ai-model-selector | `AedstAiModelSelector` | - | `[AedstMenuItem]` in AedstMenuList with the check mark; groups by `separator` (no heading rows) |
| ai-plan | `AedstAiPlan`, `AedstAiPlanDescription` | - | open by default; `[AedstAiStep]`, `action-label` + `action()` beside the line, children are the footer |
| ai-prompt-input | `AedstAiPromptInput` | - | `AedstAiPromptInputStatus`, `[AedstAiPromptInputAttachment]`; Enter sends (`submitted(text) -> bool`, Rust trims, true clears), Shift+Enter new line, `attach-requested()`, `stop-requested()`, tools are the children |
| ai-queue | `AedstAiQueue`, `AedstAiQueueSection` | - | `[AedstAiQueueItem]` (`AedstAiQueueItemStatus`), `[AedstAiQueueItemAction]` always shown, `action(todo, action)`; completed struck through |
| ai-reasoning | `AedstAiReasoning`, `...Trigger`, `...Content` | - | `open` starts bound to `streaming`; the first toggle keeps the user's choice |
| ai-sources | `AedstAiSources` | - | `[AedstAiSource]` on AedstCollapsible; `opened(url)` |
| ai-stack-trace | `AedstAiStackTrace`, `...Header`, `...Error`, `...Frames` | - | `[AedstAiStackFrame]` from `aedst_ui::stack_trace::parse_stack_trace` (app frames; `linked` rows report `frame-activated(index)`), internal frames folded as code |
| ai-subagent | `AedstAiSubagent`, `AedstAiSubagentTask`, `AedstAiSubagentMeta` | - | task, model and `[string]` tools as badge rows, `[AedstAiStep]` |
| ai-suggestion | `AedstAiSuggestion`, `AedstAiSuggestions` | - | `[string]` in a sideways `Flickable`, `picked(text)` |
| ai-task | `AedstAiTask`, `AedstAiTaskItemFile` | - | open by default; `[AedstAiTaskItem]` (`file` shows the chip under the label) |
| ai-terminal | `AedstAiTerminal` | - | `output` + `output-lines`; opens on first output while `streaming`; 256px panel follows the end; `clear-label` + `cleared()` |
| ai-test-results | `AedstAiTestResults`, `...Header`, `...Progress`, `AedstAiTestSuites`, `AedstAiTestRow` | - | `AedstAiTestStatus`, `[AedstAiTestSuite]` of `[AedstAiTest]`, `AedstAiTestCounts` from `aedst_ui::test_results::count_tests`; failed suites/tests open at first |
| ai-tool | `AedstAiTool`, `...Header`, `...Section`, `...Approval` | - | `AedstAiToolState` mapped to the trace status; input/output as code lines formatted in Rust; `error-text` as a destructive alert |
| alert | `AedstAlert` | `AedstAlertVariant` | |
| alert-dialog | `AedstAlertDialog` | `AedstAlertDialogSize` | default 384px, sm 320px with a centred header and two equal buttons |
| aspect-ratio | `AedstAspectRatio` | - | |
| attachment | `AedstAttachment` | `AedstAttachmentVariant`, `AedstAttachmentSize`, axis `AedstAttachmentOrientation` | `AedstAttachmentState` (idle, uploading, processing, error, done); no dashed border in Slint |
| avatar | `AedstAvatar` | `AedstAvatarSize` | image or initials; sm 24, default 32, lg 40px |
| badge | `AedstBadge` | `AedstBadgeVariant` | replaced the `tone` string |
| breadcrumb | `AedstBreadcrumb` | - | |
| bubble | `AedstBubble`, `AedstBubbleGroup` | `AedstBubbleVariant`, axes `AedstBubbleSide`, `AedstBubbleAlign` | reactions pill; `interactive` makes it a button |
| button | `AedstButton` | `AedstButtonVariant`, `AedstButtonSize` | replaced `primary: bool`; heights 24/28/32/36px as on web |
| button-group | `AedstButtonGroup` | axis `AedstButtonGroupOrientation` | |
| calendar | `AedstCalendar` | - | Gregorian month grid; names from the caller |
| card | `AedstCard` | `AedstCardSize` | sm: 12px spacing, text-sm title |
| carousel | `AedstCarousel` | - | slides are the children |
| chart | `AedstChart` | - | one series, `AedstChartKind { bar, line }` |
| checkbox | `AedstCheckbox` | - | unchanged |
| code-block | `AedstCodeBlock` | - | `[AedstCodeLine]` with `[AedstCodeSpan]` (`AedstCodeTokenKind`) from `aedst_ui::highlight`; a wrapped block is one colour |
| collapsible | `AedstCollapsible` | - | also exports `AedstCollapsibleTrigger` |
| combobox | `AedstCombobox` | - | the caller filters |
| command | `AedstCommand` | - | the caller filters |
| context-menu | `AedstContextMenu` | `AedstMenuItemVariant` (via `AedstMenuItem`) | gate: needs its own enum, see Known gaps |
| data-table | `AedstDataTable` | - | the caller sorts and pages |
| date-picker | `AedstDatePicker` | - | `AedstCalendar` in a popup; the caller formats the date |
| dialog | `AedstDialog` | - | |
| drawer | `AedstDrawer` | - | `AedstSheet` at the bottom with a handle; drag down past a quarter to close |
| dropdown-menu | `AedstDropdownMenu` | `AedstMenuItemVariant` | also exports `AedstMenuItem`, `AedstMenuList`, `AedstMenuRow` |
| empty | `AedstEmpty` | `AedstEmptyVariant` | |
| field | `AedstField`, `AedstFieldSet` | `AedstFieldLegendVariant`, axis `AedstFieldOrientation` | |
| form | `AedstForm` | - | layout and form-level error; validation stays in `presentation` |
| hover-card | `AedstHoverCard` | - | card content is title and description |
| input | `AedstInput` | - | **renamed** from `AedstTextField` (`aedst_text_field.slint`) |
| input-group | `AedstInputGroup` | `AedstInputGroupButtonSize`, axis `AedstInputGroupAlign` | |
| input-otp | `AedstInputOtp` | - | up to 8 characters; no paste |
| item | `AedstItem` | `AedstItemVariant`, `AedstItemMediaVariant`, `AedstItemSize` | |
| kbd | `AedstKbd` | - | |
| label | `AedstLabel` | - | unchanged |
| marker | `AedstMarker` | `AedstMarkerVariant` | |
| menubar | `AedstMenubar` | - | `[AedstMenubarMenu]` |
| message | `AedstMessage`, `AedstMessageGroup` | axis `AedstMessageAlign` | content is the children |
| message-scroller | `AedstMessageScroller` | - | `[AedstMessageScrollerItem]`, `ListView`; sticks to the bottom, jump-to-latest button |
| native-select | `AedstNativeSelect` | `AedstNativeSelectSize` | std-widgets `ComboBox`, native look |
| navigation-menu | `AedstNavigationMenu` | - | `[AedstNavigationItem]` |
| pagination | `AedstPagination` | - | |
| popover | `AedstPopover` | - | inherits `PopupWindow` |
| progress | `AedstProgress` | - | |
| questionnaire | `AedstQuestionnaire` | - | one question at a time, `AedstQuestionnaireKind`, `[AedstQuestionnaireChoice]`; the caller keeps the answers |
| radio-group | `AedstRadioGroup` | - | |
| resizable | `AedstResizable` | - | one panel with a drag handle |
| scroll-area | `AedstScrollArea` | - | `Flickable` with a token scrollbar (manifest: `native`) |
| select | `AedstSelect` | `AedstSelectSize` | |
| separator | `AedstSeparator` | - | |
| sheet | `AedstSheet` | - | `AedstSheetSide { top, right, bottom, left }` |
| sidebar | `AedstSidebar` | `AedstSidebarVariant`, `AedstSidebarSize` | `[AedstSidebarItem]`, collapses to a rail |
| skeleton | `AedstSkeleton` | - | |
| slider | `AedstSlider` | - | |
| toast | `AedstToaster` | - | toast stack, `[AedstToast]` |
| spinner | `AedstSpinner` | - | |
| switch | `AedstSwitch` | `AedstSwitchSize` | |
| table | `AedstTable` | - | |
| tabs | `AedstTabs` | `AedstTabsVariant` | |
| textarea | `AedstTextarea` | - | built-in multi-line `TextInput`; `embedded` (no border, inside AedstAiPromptInput), `content-height` |
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
  `AedstScrollArea` scrollbar is not draggable.
- Slint has no live regions: `AedstMessageScroller` does not announce streamed text, and there is no
  global reduced-motion setting (`AedstSheet`/`AedstDrawer` take `reduce-motion` from the feature).
- `context-menu` fails the kit gate's variant check: the gate wants an enum in
  `aedst_context_menu.slint`, but the item variant lives on the shared `AedstMenuItem` struct
  (`AedstMenuItemVariant`, declared in `aedst_dropdown_menu.slint`; a Slint file cannot import from a
  file that imports it). Needs a manifest deviation or a gate that follows re-exports.
- `AedstQuestionnaire` shortcuts are the digits 1-9 (Slint cannot search a model for a key).
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
- `changed viewport-y` / `viewport-height` on the std-widgets `ListView` (`AedstMessageScroller`),
  `color.mix()` (`AedstBubble`), an expression as `animate` duration (`AedstSheet`), the re-export
  `export { AedstQuestionnaireChoice }` of an imported struct, and the syntect 5.3 API in `src/highlight.rs`.
- AI batch A (2026-11-26): `@children` forwarded into a child component instance (`content :=
  AedstAiChainOfThoughtContent { @children }`) and children added by a component that `inherits` one
  with `@children` (`AedstAiReasoningContent`, `AedstAiToolApproval` on `AedstItem`); an `in-out`
  default binding (`open: root.streaming`) replaced by the first assignment; `for level in node.depth`
  (an int model); a `function` declared on a repeated element (`AedstAiFileTree`); arc commands in a
  `Path` `commands` string (`AiStatusIcon`); multi-line `export { ... } from` in `lib.slint`.
- AI batch B: `capture-key-pressed` on `FocusScope` and whether `forward-focus` from that scope
  gives one Tab stop (`AedstAiPromptInput`, Enter vs Shift+Enter), a callback with a return value
  (`submitted(string) -> bool`), named repeated elements with a declared property
  (`for slot in n: cell := Rectangle { property <T> x: ... }`), `accessible-description` on a
  `ListView` instance (`AedstAiChat`), `font-italic` on `Text` (`AedstAiInlineCitation`), and the ElementHandle methods `accessible_expanded` /
  `accessible_enabled` in `tests/ai_2.rs`.

## Gallery and tests

`cargo run -p aedst-ui --example gallery -- [--rtl] [--dark] [--page <0..5>]` (0 basics, 1 forms,
2 display, 3 navigation, 4 overlays, 5 messages). `tests/ui.rs` covers the original components;
`tests/components.rs`, `tests/navigation.rs` and `tests/messages.rs` cover the newer ones through
accessible actions, key presses and pointer drags (popups are not covered). `src/highlight.rs` has
unit tests. Page 6 (`ui/gallery/gallery_ai.slint`) holds the AI Elements of batch A, driven by
`tests/ai.rs`; `src/stack_trace.rs` and `src/test_results.rs` have unit tests.
