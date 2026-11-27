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

The UI kit is the current shadcn/ui component set, **66 components** (`trace`
and `code-block` are official shadcn components), plus the **21 shadcn AI
Elements** (the AI patterns at <https://ui.shadcn.com/docs/ai-elements>, entries
prefixed `ai-` so `ai-message` does not collide with the base `message`):
**87 entries, the same on every platform**. AI Elements have no package on any
platform: each is composed from the base kit components.

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
   ignored, so `icon-sm`, `ICON_SM` and `iconSm` are the same name. On web an
   axis may also be a string-literal union prop outside `cva` (`avatar`
   `size?: "default" | "sm" | "lg"`, `card` `size`); the gate reads the union,
   so such an axis can no longer go undeclared. A platform
   that differs on purpose records it in the manifest under the entry's
   `deviations:` key (`<platform>: { <axis>: { values, reason } }`); the reason
   is mandatory and the listed values are checked against the file.
3. **A new component lands in the manifest first**, then on web, then on the
   other platforms. A kit file that the manifest does not list fails the gate,
   on every platform.
4. A kit file outside the canonical set is an **extension** (listed per
   platform under `extensions:`); it is not part of the parity count. `form`
   is one since shadcn replaced Form with Field; the files stay for the React
   Hook Form wiring.
5. **Every component is exercised on every platform** (`coverage:` in the
   manifest): a story or test on web, a unit or UI test on Android and Apple, a
   compiled gallery page or UI test on Desktop.
6. **API contract**: a component may list `props:` in the manifest; each name
   must be a parameter of the component on every platform, so a port cannot
   silently drop behaviour.

`toast` is the canonical name, as in shadcn. On web it is still served by
Sonner (`sonner.tsx`): Sonner is the only toast on web (Biome bans
`@/shared/ui/toast`, see [Library-First: Web](/library-first/web)). Upstream
shadcn `toast` is now built on Base UI Toast; moving to it is an open decision,
not done here. Desktop exports the stack as `AedstToaster` (web `Toaster`).

Gate: `task check:ui-kit` (`node scripts/check-ui-kit.mjs`, in `task check` and
in the `policies-ci` workflow). It fails when an entry marked `implemented` has
no file, when an undeclared kit file exists, when an entry is `missing` on any
platform, when a declared variant or size differs from the web `cva` definition
(or prop union) or from the enums of an Android, Apple or Desktop kit file
without a recorded deviation, when a web component has no story, when a
component is not exercised on a platform, when a `props:` name is absent from a
platform's file, or when the matrix below is out of date. `native` stays for an
entry the platform SDK provides (Android: `aspect-ratio`, `scroll-area`;
`direction` on Android, Apple and Desktop, where the locale drives mirroring).
The parity report is printed on every run. The gate still reads sources, not
pixels: visual parity is covered by web visual tests and the native snapshot
and screenshot tests, behaviour by each platform's tests.

## Feature code uses the kit only

The kit is closed in one direction: screens are composed from kit components and nothing else. `task check:ui-kit-only` (`scripts/check-ui-kit-only.mjs`, in `task check`, lefthook and `policies-ci`) fails on a raw control in feature code: web `<button>`, `<input>`, `<select>`, `<textarea>`, `<label>`, `<form>`, `<table>`, `<dialog>` and friends, and direct imports of the libraries behind the kit; Android Material 3 controls outside `core/ui`; SwiftUI controls and `.sheet`/`.alert` outside `AedstDesignSystem`; `std-widgets.slint` outside `aedst-ui`, except exactly `import { ListView }` in a Desktop feature (Slint creates rows lazily only for a `for` written directly inside `ListView`, so the kit cannot wrap it; [rule M1](/desktop/slint-rules)). Layout primitives, text and icons are not kit components. Web is also enforced while editing by Biome `noRestrictedElements`. Apple has recorded debt in `scripts/ui-kit-only.baseline` (a per-file ratchet that may only go down; new files get 0). A one-line exemption is a `ui-kit-ignore: <reason>` comment.

## Component reference

Every component has its own page under [Component reference](/ui-kit/components):
the canonical variants and sizes and, per platform, the status, the source file,
the public API (signatures and enums read from the source) and a usage example
taken from a story, a preview or the kit gallery. The pages are generated by
`scripts/ui-kit/component-docs.mjs` from `ui-kit.yaml` and the kit sources and
are never edited by hand; `task check:ui-kit` fails when they are stale. A new
component is a manifest entry first, then the implementation, then
`task docs:ui-kit`. Each component name in the matrix below links to its page.

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
| Web | 87 | 0 | 0 | 87 |
| Android | 84 | 3 | 0 | 87 |
| Apple | 86 | 1 | 0 | 87 |
| Desktop | 86 | 1 | 0 | 87 |

| Component | Variants | Sizes | Web | Android | Apple | Desktop |
|---|---|---|---|---|---|---|
| [`accordion`](/ui-kit/components/accordion) | - | - | yes (`accordion`) | yes (`AedstAccordion`) | yes (`AedstAccordion`) | yes (`aedst_accordion`) |
| [`alert`](/ui-kit/components/alert) | `default`, `destructive` | - | yes (`alert`) | yes (`AedstAlert`) | yes (`AedstAlert`) | yes (`aedst_alert`) |
| [`alert-dialog`](/ui-kit/components/alert-dialog) | - | `default`, `sm` | yes (`alert-dialog`) | yes (`AedstAlertDialog`) | yes (`AedstAlertDialog`) | yes (`aedst_alert_dialog`) |
| [`aspect-ratio`](/ui-kit/components/aspect-ratio) | - | - | yes (`aspect-ratio`) | native (Modifier.aspectRatio) | yes (`AedstAspectRatio`) | yes (`aedst_aspect_ratio`) |
| [`avatar`](/ui-kit/components/avatar) | - | `default`, `sm`, `lg` | yes (`avatar`) | yes (`AedstAvatar`) | yes (`AedstAvatar`) | yes (`aedst_avatar`) |
| [`badge`](/ui-kit/components/badge) | `default`, `secondary`, `destructive`, `success`, `warning`, `info`, `outline`, `ghost`, `link` | - | yes (`badge`) | yes (`AedstBadge`) | yes (`AedstBadge`) | yes (`aedst_badge`) |
| [`breadcrumb`](/ui-kit/components/breadcrumb) | - | - | yes (`breadcrumb`) | yes (`AedstBreadcrumb`) | yes (`AedstBreadcrumb`) | yes (`aedst_breadcrumb`) |
| [`button`](/ui-kit/components/button) | `default`, `outline`, `secondary`, `ghost`, `destructive`, `link` | `default`, `xs`, `sm`, `lg`, `icon`, `icon-xs`, `icon-sm`, `icon-lg` | yes (`button`) | yes (`AedstButton`) | yes (`AedstButton`) | yes (`aedst_button`) |
| [`button-group`](/ui-kit/components/button-group) | - | - | yes (`button-group`) | yes (`AedstButtonGroup`) | yes (`AedstButtonGroup`) | yes (`aedst_button_group`) |
| [`calendar`](/ui-kit/components/calendar) | - | - | yes (`calendar`) | yes (`AedstCalendar`) | yes (`AedstCalendar`) | yes (`aedst_calendar`) |
| [`card`](/ui-kit/components/card) | - | `default`, `sm` | yes (`card`) | yes (`AedstCard`) | yes (`AedstCard`) | yes (`aedst_card`) |
| [`carousel`](/ui-kit/components/carousel) | - | - | yes (`carousel`) | yes (`AedstCarousel`) | yes (`AedstCarousel`) | yes (`aedst_carousel`) |
| [`chart`](/ui-kit/components/chart) | - | - | yes (`chart`) | yes (`AedstChart`) | yes (`AedstChart`) | yes (`aedst_chart`) |
| [`checkbox`](/ui-kit/components/checkbox) | - | - | yes (`checkbox`) | yes (`AedstCheckbox`) | yes (`AedstCheckbox`) | yes (`aedst_checkbox`) |
| [`collapsible`](/ui-kit/components/collapsible) | - | - | yes (`collapsible`) | yes (`AedstCollapsible`) | yes (`AedstCollapsible`) | yes (`aedst_collapsible`) |
| [`combobox`](/ui-kit/components/combobox) | - | - | yes (`combobox`) | yes (`AedstCombobox`) | yes (`AedstCombobox`) | yes (`aedst_combobox`) |
| [`command`](/ui-kit/components/command) | - | - | yes (`command`) | yes (`AedstCommand`) | yes (`AedstCommand`) | yes (`aedst_command`) |
| [`context-menu`](/ui-kit/components/context-menu) | `default`, `destructive` | - | yes (`context-menu`) | yes (`AedstContextMenu`) | yes (`AedstContextMenu`) | yes (`aedst_context_menu`) |
| [`data-table`](/ui-kit/components/data-table) | - | - | yes (`data-table`) | yes (`AedstDataTable`) | yes (`AedstDataTable`) | yes (`aedst_data_table`) |
| [`date-picker`](/ui-kit/components/date-picker) | - | - | yes (`date-picker`) | yes (`AedstDatePicker`) | yes (`AedstDatePicker`) | yes (`aedst_date_picker`) |
| [`dialog`](/ui-kit/components/dialog) | - | - | yes (`dialog`) | yes (`AedstDialog`) | yes (`AedstDialog`) | yes (`aedst_dialog`) |
| [`drawer`](/ui-kit/components/drawer) | - | - | yes (`drawer`) | yes (`AedstBottomSheet`) | yes (`AedstDrawer`) | yes (`aedst_drawer`) |
| [`dropdown-menu`](/ui-kit/components/dropdown-menu) | `default`, `destructive` | - | yes (`dropdown-menu`) | yes (`AedstDropdownMenu`) | yes (`AedstDropdownMenu`) | yes (`aedst_dropdown_menu`) |
| [`empty`](/ui-kit/components/empty) | `default`, `icon` | - | yes (`empty`) | yes (`AedstEmpty`) | yes (`AedstEmpty`) | yes (`aedst_empty`) |
| [`field`](/ui-kit/components/field) | `legend`, `label` | - | yes (`field`) | yes (`AedstField`) | yes (`AedstField`) | yes (`aedst_field`) |
| [`hover-card`](/ui-kit/components/hover-card) | - | - | yes (`hover-card`) | yes (`AedstHoverCard`) | yes (`AedstHoverCard`) | yes (`aedst_hover_card`) |
| [`input`](/ui-kit/components/input) | - | - | yes (`input`) | yes (`AedstTextField`) | yes (`AedstTextField`) | yes (`aedst_input`) |
| [`input-group`](/ui-kit/components/input-group) | - | `xs`, `sm`, `icon-xs`, `icon-sm` | yes (`input-group`) | yes (`AedstInputGroup`) | yes (`AedstInputGroup`) | yes (`aedst_input_group`) |
| [`input-otp`](/ui-kit/components/input-otp) | - | - | yes (`input-otp`) | yes (`AedstInputOtp`) | yes (`AedstInputOTP`) | yes (`aedst_input_otp`) |
| [`item`](/ui-kit/components/item) | `default`, `outline`, `muted`, `icon`, `image` | `default`, `sm`, `xs` | yes (`item`) | yes (`AedstItem`) | yes (`AedstItem`) | yes (`aedst_item`) |
| [`kbd`](/ui-kit/components/kbd) | - | - | yes (`kbd`) | yes (`AedstKbd`) | yes (`AedstKbd`) | yes (`aedst_kbd`) |
| [`label`](/ui-kit/components/label) | - | - | yes (`label`) | yes (`AedstLabel`) | yes (`AedstLabel`) | yes (`aedst_label`) |
| [`menubar`](/ui-kit/components/menubar) | - | - | yes (`menubar`) | yes (`AedstMenubar`) | yes (`AedstMenubar`) | yes (`aedst_menubar`) |
| [`native-select`](/ui-kit/components/native-select) | - | `default`, `sm` | yes (`native-select`) | yes (`AedstNativeSelect`) | yes (`AedstNativeSelect`) | yes (`aedst_native_select`) |
| [`navigation-menu`](/ui-kit/components/navigation-menu) | - | - | yes (`navigation-menu`) | yes (`AedstNavigationMenu`) | yes (`AedstNavigationMenu`) | yes (`aedst_navigation_menu`) |
| [`pagination`](/ui-kit/components/pagination) | - | - | yes (`pagination`) | yes (`AedstPagination`) | yes (`AedstPagination`) | yes (`aedst_pagination`) |
| [`popover`](/ui-kit/components/popover) | - | - | yes (`popover`) | yes (`AedstPopover`) | yes (`AedstPopover`) | yes (`aedst_popover`) |
| [`progress`](/ui-kit/components/progress) | - | - | yes (`progress`) | yes (`AedstProgressIndicator`) | yes (`AedstProgressView`) | yes (`aedst_progress`) |
| [`radio-group`](/ui-kit/components/radio-group) | - | - | yes (`radio-group`) | yes (`AedstRadioGroup`) | yes (`AedstRadioGroup`) | yes (`aedst_radio_group`) |
| [`resizable`](/ui-kit/components/resizable) | - | - | yes (`resizable`) | yes (`AedstResizable`) | yes (`AedstResizable`) | yes (`aedst_resizable`) |
| [`scroll-area`](/ui-kit/components/scroll-area) | - | - | yes (`scroll-area`) | native (Compose scroll modifiers and lazy lists) | yes (`AedstScrollArea`) | yes (`aedst_scroll_area`) |
| [`select`](/ui-kit/components/select) | - | `default`, `sm` | yes (`select`) | yes (`AedstSelect`) | yes (`AedstSelect`) | yes (`aedst_select`) |
| [`separator`](/ui-kit/components/separator) | - | - | yes (`separator`) | yes (`AedstDivider`) | yes (`AedstSeparator`) | yes (`aedst_separator`) |
| [`sheet`](/ui-kit/components/sheet) | - | - | yes (`sheet`) | yes (`AedstSheet`) | yes (`AedstSheet`) | yes (`aedst_sheet`) |
| [`sidebar`](/ui-kit/components/sidebar) | `default`, `outline` | `default`, `sm`, `lg` | yes (`sidebar`) | yes (`AedstSidebar`) | yes (`AedstSidebar`) | yes (`aedst_sidebar`) |
| [`skeleton`](/ui-kit/components/skeleton) | - | - | yes (`skeleton`) | yes (`AedstSkeleton`) | yes (`AedstSkeleton`) | yes (`aedst_skeleton`) |
| [`slider`](/ui-kit/components/slider) | - | - | yes (`slider`) | yes (`AedstSlider`) | yes (`AedstSlider`) | yes (`aedst_slider`) |
| [`spinner`](/ui-kit/components/spinner) | - | - | yes (`spinner`) | yes (`AedstSpinner`) | yes (`AedstSpinner`) | yes (`aedst_spinner`) |
| [`switch`](/ui-kit/components/switch) | - | `default`, `sm` | yes (`switch`) | yes (`AedstSwitch`) | yes (`AedstSwitch`) | yes (`aedst_switch`) |
| [`table`](/ui-kit/components/table) | - | - | yes (`table`) | yes (`AedstTable`) | yes (`AedstTable`) | yes (`aedst_table`) |
| [`tabs`](/ui-kit/components/tabs) | `default`, `line` | - | yes (`tabs`) | yes (`AedstTabs`) | yes (`AedstTabs`) | yes (`aedst_tabs`) |
| [`textarea`](/ui-kit/components/textarea) | - | - | yes (`textarea`) | yes (`AedstTextArea`) | yes (`AedstTextarea`) | yes (`aedst_textarea`) |
| [`toast`](/ui-kit/components/toast) | - | - | yes (`sonner`) | yes (`AedstSnackbar`) | yes (`AedstToast`) | yes (`aedst_toast`) |
| [`toggle`](/ui-kit/components/toggle) | `default`, `outline` | `default`, `sm`, `lg` | yes (`toggle`) | yes (`AedstToggle`) | yes (`AedstToggle`) | yes (`aedst_toggle`) |
| [`toggle-group`](/ui-kit/components/toggle-group) | - | - | yes (`toggle-group`) | yes (`AedstToggleGroup`) | yes (`AedstToggleGroup`) | yes (`aedst_toggle_group`) |
| [`tooltip`](/ui-kit/components/tooltip) | - | - | yes (`tooltip`) | yes (`AedstTooltip`) | yes (`AedstTooltip`) | yes (`aedst_tooltip`) |
| [`typography`](/ui-kit/components/typography) | `h1`, `h2`, `h3`, `h4`, `p`, `blockquote`, `list`, `inline-code`, `lead`, `large`, `small`, `muted` | - | yes (`typography`) | yes (`AedstTypography`) | yes (`AedstText`) | yes (`aedst_typography`) |
| [`trace`](/ui-kit/components/trace) | - | - | yes (`trace`) | yes (`AedstTrace`) | yes (`AedstTrace`) | yes (`aedst_trace`) |
| [`code-block`](/ui-kit/components/code-block) | - | - | yes (`code-block`) | yes (`AedstCodeBlock`) | yes (`AedstCodeBlock`) | yes (`aedst_code_block`) |
| [`attachment`](/ui-kit/components/attachment) | `icon`, `image` | `default`, `sm`, `xs` | yes (`attachment`) | yes (`AedstAttachment`) | yes (`AedstAttachment`) | yes (`aedst_attachment`) |
| [`bubble`](/ui-kit/components/bubble) | `default`, `secondary`, `muted`, `tinted`, `outline`, `ghost`, `destructive` | - | yes (`bubble`) | yes (`AedstBubble`) | yes (`AedstBubble`) | yes (`aedst_bubble`) |
| [`direction`](/ui-kit/components/direction) | - | - | yes (`direction`) | native (LocalLayoutDirection (CompositionLocal); Compose mirrors layouts from the locale) | native (the layoutDirection environment value; SwiftUI mirrors layouts from the locale) | native (AedstLayout.rtl global (aedst_layout.slint), set from the locale; Slint itself does not mirror) |
| [`marker`](/ui-kit/components/marker) | `default`, `separator`, `border` | - | yes (`marker`) | yes (`AedstMarker`) | yes (`AedstMarker`) | yes (`aedst_marker`) |
| [`message`](/ui-kit/components/message) | - | - | yes (`message`) | yes (`AedstMessage`) | yes (`AedstMessage`) | yes (`aedst_message`) |
| [`message-scroller`](/ui-kit/components/message-scroller) | - | - | yes (`message-scroller`) | yes (`AedstMessageScroller`) | yes (`AedstMessageScroller`) | yes (`aedst_message_scroller`) |
| [`questionnaire`](/ui-kit/components/questionnaire) | - | - | yes (`questionnaire`) | yes (`AedstQuestionnaire`) | yes (`AedstQuestionnaire`) | yes (`aedst_questionnaire`) |
| [`ai-chain-of-thought`](/ui-kit/components/ai-chain-of-thought) | - | - | yes (`ai-chain-of-thought`) | yes (`AedstAiChainOfThought`) | yes (`AedstAiChainOfThought`) | yes (`aedst_ai_chain_of_thought`) |
| [`ai-chat`](/ui-kit/components/ai-chat) | - | - | yes (`ai-chat`) | yes (`AedstAiChat`) | yes (`AedstAiChat`) | yes (`aedst_ai_chat`) |
| [`ai-checkpoint`](/ui-kit/components/ai-checkpoint) | - | - | yes (`ai-checkpoint`) | yes (`AedstAiCheckpoint`) | yes (`AedstAiCheckpoint`) | yes (`aedst_ai_checkpoint`) |
| [`ai-confirmation`](/ui-kit/components/ai-confirmation) | - | - | yes (`ai-confirmation`) | yes (`AedstAiConfirmation`) | yes (`AedstAiConfirmation`) | yes (`aedst_ai_confirmation`) |
| [`ai-context`](/ui-kit/components/ai-context) | - | - | yes (`ai-context`) | yes (`AedstAiContext`) | yes (`AedstAiContext`) | yes (`aedst_ai_context`) |
| [`ai-file-tree`](/ui-kit/components/ai-file-tree) | - | - | yes (`ai-file-tree`) | yes (`AedstAiFileTree`) | yes (`AedstAiFileTree`) | yes (`aedst_ai_file_tree`) |
| [`ai-inline-citation`](/ui-kit/components/ai-inline-citation) | - | - | yes (`ai-inline-citation`) | yes (`AedstAiInlineCitation`) | yes (`AedstAiInlineCitation`) | yes (`aedst_ai_inline_citation`) |
| [`ai-message`](/ui-kit/components/ai-message) | - | - | yes (`ai-message`) | yes (`AedstAiMessage`) | yes (`AedstAiMessage`) | yes (`aedst_ai_message`) |
| [`ai-model-selector`](/ui-kit/components/ai-model-selector) | - | - | yes (`ai-model-selector`) | yes (`AedstAiModelSelector`) | yes (`AedstAiModelSelector`) | yes (`aedst_ai_model_selector`) |
| [`ai-plan`](/ui-kit/components/ai-plan) | - | - | yes (`ai-plan`) | yes (`AedstAiPlan`) | yes (`AedstAiPlan`) | yes (`aedst_ai_plan`) |
| [`ai-prompt-input`](/ui-kit/components/ai-prompt-input) | - | - | yes (`ai-prompt-input`) | yes (`AedstAiPromptInput`) | yes (`AedstAiPromptInput`) | yes (`aedst_ai_prompt_input`) |
| [`ai-queue`](/ui-kit/components/ai-queue) | - | - | yes (`ai-queue`) | yes (`AedstAiQueue`) | yes (`AedstAiQueue`) | yes (`aedst_ai_queue`) |
| [`ai-reasoning`](/ui-kit/components/ai-reasoning) | - | - | yes (`ai-reasoning`) | yes (`AedstAiReasoning`) | yes (`AedstAiReasoning`) | yes (`aedst_ai_reasoning`) |
| [`ai-sources`](/ui-kit/components/ai-sources) | - | - | yes (`ai-sources`) | yes (`AedstAiSources`) | yes (`AedstAiSources`) | yes (`aedst_ai_sources`) |
| [`ai-stack-trace`](/ui-kit/components/ai-stack-trace) | - | - | yes (`ai-stack-trace`) | yes (`AedstAiStackTrace`) | yes (`AedstAiStackTrace`) | yes (`aedst_ai_stack_trace`) |
| [`ai-subagent`](/ui-kit/components/ai-subagent) | - | - | yes (`ai-subagent`) | yes (`AedstAiSubagent`) | yes (`AedstAiSubagent`) | yes (`aedst_ai_subagent`) |
| [`ai-suggestion`](/ui-kit/components/ai-suggestion) | - | - | yes (`ai-suggestion`) | yes (`AedstAiSuggestion`) | yes (`AedstAiSuggestion`) | yes (`aedst_ai_suggestion`) |
| [`ai-task`](/ui-kit/components/ai-task) | - | - | yes (`ai-task`) | yes (`AedstAiTask`) | yes (`AedstAiTask`) | yes (`aedst_ai_task`) |
| [`ai-terminal`](/ui-kit/components/ai-terminal) | - | - | yes (`ai-terminal`) | yes (`AedstAiTerminal`) | yes (`AedstAiTerminal`) | yes (`aedst_ai_terminal`) |
| [`ai-test-results`](/ui-kit/components/ai-test-results) | - | - | yes (`ai-test-results`) | yes (`AedstAiTestResults`) | yes (`AedstAiTestResults`) | yes (`aedst_ai_test_results`) |
| [`ai-tool`](/ui-kit/components/ai-tool) | - | - | yes (`ai-tool`) | yes (`AedstAiTool`) | yes (`AedstAiTool`) | yes (`aedst_ai_tool`) |

| Platform | Extensions (outside the canonical set) |
|---|---|
| Web | `form`, `loading-skeleton`, `locale-select`, `mode-toggle` |
| Android | `AedstAiDisclosureScope`, `AedstCountBadge`, `AedstFab`, `AedstFilterChip`, `AedstForm`, `AedstIconButton`, `AedstOfflineBanner`, `AedstTopAppBar`, `ErrorMessages`, `LoadingIndicator` |
| Apple | `AedstErrorPresenter`, `AedstForm`, `AedstIconButton` |
| Desktop | `aedst_action_row`, `aedst_form`, `aedst_a11y`, `aedst_sizes`, `aedst_contrast` |

| Component | Platform | Axis | Platform values | Reason for the deviation |
|---|---|---|---|---|
| `context-menu` | Apple | variant | - | declared once as AedstMenuItemVariant (default, destructive) in AedstDropdownMenu.swift, shared by the context menu |
| `context-menu` | Desktop | variant | - | declared once as AedstMenuItemVariant (default, destructive) in aedst_dropdown_menu.slint, which aedst_context_menu.slint imports |

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
