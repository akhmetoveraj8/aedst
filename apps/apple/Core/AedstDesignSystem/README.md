# AedstDesignSystem

SwiftUI design system for `apps/apple`: tokens shared with the other platforms plus the full
component kit of `ui-kit.yaml`. Everything lives under `Sources/AedstDesignSystem/`.

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

The kit carries the full manifest set (`ui-kit.yaml`: the 59 shadcn/ui names plus `trace` and `code-block`),
one component per file, named `Aedst<ShadcnName>.swift`. Variants and sizes are the manifest's, as lowerCamelCase
enum cases (`.default`, `.iconSm`). Every `.swift` file in `Components/` must be a kit component (the manifest
checker counts them); shared helpers live one level up (`AedstHitTarget.swift`) or in `Components/Support/`
(`AedstSyntaxHighlighter.swift`, `AedstQuestionnaireModel.swift`), which the checker does not count.

| Group | Components |
|---|---|
| Layout | `AedstCard`, `AedstSeparator`, `AedstAspectRatio`, `AedstScrollArea`, `AedstResizable`, `AedstSidebar`, `AedstCarousel` |
| Actions | `AedstButton` (variants `default/outline/secondary/ghost/destructive/link`, sizes `default/xs/sm/lg/icon/iconXs/iconSm/iconLg`), `AedstButtonGroup`, `AedstToggle`, `AedstToggleGroup`, `AedstIconButton` (extension) |
| Forms | `AedstTextField` (`input`), `AedstTextarea`, `AedstLabel`, `AedstField`, `AedstForm`, `AedstInputGroup`, `AedstInputOTP`, `AedstCheckbox`, `AedstSwitch`, `AedstRadioGroup`, `AedstSlider`, `AedstSelect`, `AedstNativeSelect`, `AedstCombobox`, `AedstCalendar`, `AedstDatePicker` |
| Feedback | `AedstAlert` (variants `default/destructive`), `.aedstAlertDialog()`, `.aedstToast()` (`sonner`; `AedstToastSeverity`), `AedstProgressView`, `AedstSpinner`, `AedstSkeleton`, `AedstBadge` (9 variants), `AedstEmpty`, `.aedstErrorPresenter()` (extension) |
| Overlay | `.aedstSheet()`, `.aedstDialog()`, `.aedstDrawer()`, `.aedstPopover()`, `AedstHoverCard`, `.aedstTooltip()`, `AedstDropdownMenu`, `.aedstContextMenu()`, `AedstMenubar`, `AedstNavigationMenu`, `AedstCommand` |
| Navigation | `AedstTabs`, `AedstBreadcrumb`, `AedstPagination`, `AedstAccordion`, `AedstCollapsible` |
| Conversation | `AedstMessage` (`align` start/end; `AedstMessageGroup`, `AedstMessageHeader`, `AedstMessageFooter`), `AedstBubble` (7 variants; `AedstBubbleGroup`, `.aedstBubbleReactions(side:align:)`), `AedstMarker` (variants `default/separator/border`), `AedstAttachment` (media variant `icon/image`, sizes `default/sm/xs`, orientation; `AedstAttachmentAction`, `AedstAttachmentGroup`), `AedstMessageScroller`, `AedstQuestionnaire` (+ `AedstQuestionnaireState`) |
| AI Elements (batch B) | `AedstAiChat` (+ `AedstAiChatItem`, `AedstAiChatEmptyState`; on `AedstMessageScroller`), `AedstAiMessage` (role `user/assistant/system`; `Header`, `Content`, `Response` with opt-in inline Markdown, `Actions`, `Action`), `AedstAiPromptInput` (status `ready/submitted/streaming/error`; `Header`, `Textarea`, `Footer`, `Tools`, `AttachButton` with file importer and `PhotosPicker`, `Submit` with stop; draft in `Support/AedstAiPromptDraft.swift`), `AedstAiModelSelector` (on `AedstDropdownMenu`; `Trigger`, `Logo`, `LogoGroup`, `Name`), `AedstAiSuggestions` / `AedstAiSuggestion`, `AedstAiContext` (FormatStyle compact and percent in the current locale; `Trigger`, `Content`, `ContentHeader/Body/Footer`, `UsageRow`), `AedstAiConfirmation` (on `AedstItem`; `Request`, `Accepted`, `Rejected`, `Actions`, `Action`), `AedstAiInlineCitation` (`Text`, `Card` popover, `Source`, `Quote`), `AedstAiSources` (on `AedstCollapsible`; `Trigger`, `Content`, `AedstAiSource`) |
| AI Elements (agent work) | `AedstAiChainOfThought` (owns the shared line parts `...Header`, `...Content`, `...Steps`, `...Step`; extras `...SearchResults`, `...SearchResult`, `...Image` in `Support/`), `AedstAiReasoning` (`...Trigger`, `...Content`), `AedstAiPlan` (`...Trigger`, `...Action`, `...Description`, `...Steps`, `...Step`, `...Footer`), `AedstAiTask` (`...Trigger`, `...Item`, `...ItemFile`), `AedstAiTool` (`AedstAiToolState`; `...Header`, `...Input`, `...Output`, `...Approval`), `AedstAiSubagent` (`...Trigger`, `...Task`, `...Meta`, `...Model`, `...Tools`, `...Steps`, `...Step`), `AedstAiQueue` (`AedstAiQueueItemStatus`; `...Section`, `...SectionTrigger`, `...List`, `...Item`, `...ItemActions`, `...ItemAction`), `AedstAiCheckpoint` (`...Trigger`), `AedstAiFileTree` (`@Observable AedstAiFileTreeState`; `...Folder`, `...File`, `...Icon`, `...Name`, `...Actions`), `AedstAiStackTrace` (`...Header`, `...Error`, `...Frames`; parser `AedstAiStackTraceParser` in `Support/`), `AedstAiTerminal` (`...Title`, `...ClearButton`, `...Content`), `AedstAiTestResults` (`AedstAiTestStatus`, `AedstAiTestCounts`; `...Header`, `...Progress`, `...Suites`, `...Suite`, `AedstAiTest`). Status vocabulary is `AedstTraceStatus`; labels are parameters |
| Data display | `AedstAvatar` (image slot + monogram; the remote-image version is `AedstRemoteAvatar` in `Core/AedstMedia`), `AedstItem`, `AedstTable`, `AedstDataTable`, `AedstChart` (Swift Charts), `AedstText` (`typography`; `AedstTypography` is the font token scale), `AedstKbd`, `AedstTrace`, `AedstCodeBlock` |

Every component has a `#Preview` and accessibility labels/hints/values on interactive
elements. Typography always goes through `AedstTypography`/`.font()` on top of
Dynamic-Type-aware `Font.system(...)` text styles, with no hardcoded point sizes. Colors come
only from `AedstColor`. Controls whose drawn shape is under 44 pt use `aedstHitTarget()` on touch platforms.

Platforms: the components added on 2026-11-21 are compiled for iOS, macOS and visionOS only
(`#if os(iOS) || os(macOS) || os(visionOS)` around the file); tvOS and watchOS are scaffolded package platforms
without app targets. Differences between iOS and macOS (hover, menus, sheets against popovers, the sidebar) are
the smallest `#if os(...)` inside the component: the package stays one shared library for both app targets.

## Deliberate adaptations (web concept → SwiftUI/HIG equivalent)

- **Sheet** / **Dialog** / **Drawer** → native `.sheet()` wrappers, not custom overlays.
- **AlertDialog** → a kit-drawn card (sizes `default`/`sm` as on web: width, header alignment, action layout) presented
  full-screen over a blurred backdrop on iOS/visionOS and as a window-modal sheet on macOS; it closes only through
  its buttons (Escape cancels). The native `.alert()` cannot express the sizes or the media slot.
- **Switch** → `Toggle` with a kit `ToggleStyle` (web track and thumb sizes `default`/`sm`), so VoiceOver still reads a switch.
- **CodeBlock** syntax highlighting → HighlightSwift (highlight.js in JavaScriptCore) mapped to the `syntax*` color
  tokens through marker colors; iOS, macOS and visionOS only; plain text when the language is unknown.
- **DropdownMenu**, **ContextMenu**, **Menubar**, **Select**, **NativeSelect** → native `Menu`, `contextMenu`, `Picker`. `AedstMenubar` is an in-window row of menus; the real macOS menu bar stays `commands` in the app target.
- **Tooltip** / **HoverCard** → `.help` and `onHover` on macOS, a long press on touch platforms.
- **Calendar**, **DatePicker**, **ScrollArea**, **AspectRatio**, **Slider**, **Spinner** → thin wrappers over the system control so the kit name exists on every platform.
- **Table** → `Grid`-based primitives (SwiftUI `Table` collapses to one column on iPhone).
- **Form** → a tokenized stack with `.onSubmit`; validation stays in the view model (React Hook Form has no counterpart).
- **Checkbox** / **RadioGroup** → hand-built (`RoundedRectangle`+checkmark / `Circle`+dot), since neither has a native SwiftUI control on iOS.
- **Skeleton** → hand-built shimmer (`LinearGradient` sweep over a muted block), since SwiftUI has no native placeholder-loading view.
- **Toast** → hand-built overlay + auto-dismiss `ViewModifier`, since SwiftUI has no native toast/snackbar.

## Tests

- `AedstStringsTests`, `AedstSpacingTests`: catalog and token sanity.
- `Aedst<Component>Tests`: pure logic of components (pagination window, OTP sanitising, trace diffing, filtering, ...).
- `Snapshots/`: pixel snapshots on iPhone, iPad, macOS, light/dark, large Dynamic Type and RTL.
  **No reference images exist yet**, see `Tests/AedstDesignSystemTests/Snapshots/README.md`.

## Verification

Written in a sandbox with no Swift toolchain. Nothing in this package was compiled or run
there; the first real `swift build` / `xcodebuild test` on a Mac is its acceptance test.
Platform minimums are iOS 18 / macOS 15 (watchOS 11 / tvOS 18 / visionOS 2 are scaffolded only);
every SwiftUI API used is available at those floors.
