import SwiftUI

// iOS, macOS and visionOS only: tvOS and watchOS are scaffolded package platforms without app targets.
#if os(iOS) || os(macOS) || os(visionOS)

/// Preview card for a link or a name, matching shadcn/ui `HoverCard`.
///
/// - With a pointer (macOS, iPadOS trackpad or mouse, visionOS gaze): the card opens after the pointer rests
///   on the trigger for `openDelay` and closes `closeDelay` after it leaves both the trigger and the card.
/// - On touch there is no hover: touch and hold opens the card, a tap outside closes it.
/// - VoiceOver and Switch Control get a "Show details" action on the trigger.
///
/// The card is supplementary: whatever it shows must also be reachable by activating the trigger.
public struct AedstHoverCard<Trigger: View, Card: View>: View {
    private let openDelay: Duration
    private let closeDelay: Duration
    private let trigger: Trigger
    private let card: Card

    @State private var isPresented = false
    @State private var isTriggerHovered = false
    @State private var isCardHovered = false
    @State private var hoverTask: Task<Void, Never>?
    @FocusState private var isTriggerFocused: Bool

    /// - Parameters:
    ///   - openDelay: How long the pointer rests on the trigger before the card opens.
    ///   - closeDelay: Grace period for moving the pointer from the trigger into the card.
    ///   - trigger: The always-visible view (a name, a link, an avatar).
    ///   - card: Content of the card.
    public init(
        openDelay: Duration = .milliseconds(600),
        closeDelay: Duration = .milliseconds(300),
        @ViewBuilder trigger: () -> Trigger,
        @ViewBuilder card: () -> Card
    ) {
        self.openDelay = openDelay
        self.closeDelay = closeDelay
        self.trigger = trigger()
        self.card = card()
    }

    public var body: some View {
        trigger
            .onHover { hovering in
                isTriggerHovered = hovering
                scheduleHoverUpdate()
            }
            #if !os(macOS)
            // Simultaneous, so a trigger that is itself a button or a link keeps its tap.
            .simultaneousGesture(
                LongPressGesture(minimumDuration: 0.5).onEnded { _ in
                    isPresented = true
                }
            )
            #endif
            .accessibilityAction(named: Text(AedstStrings.showDetails)) {
                isPresented = true
            }
            // Keyboard equivalent of hover (as in Radix): the card opens when the trigger takes focus.
            .focusable()
            .focused($isTriggerFocused)
            .onChange(of: isTriggerFocused) { _, focused in
                if focused { isPresented = true }
            }
            .popover(isPresented: $isPresented, attachmentAnchor: .rect(.bounds), arrowEdge: Edge.bottom) {
                AedstPopoverSurface {
                    card.frame(minWidth: 240, maxWidth: 320, alignment: .leading)
                }
                .onHover { hovering in
                    isCardHovered = hovering
                    scheduleHoverUpdate()
                }
            }
            .onDisappear {
                hoverTask?.cancel()
            }
    }

    /// Opens or closes after the matching delay; a newer pointer event replaces the pending one.
    private func scheduleHoverUpdate() {
        hoverTask?.cancel()
        let shouldBePresented = isTriggerHovered || isCardHovered
        let delay = shouldBePresented ? openDelay : closeDelay
        hoverTask = Task {
            try? await Task.sleep(for: delay)
            guard !Task.isCancelled else { return }
            isPresented = shouldBePresented
        }
    }
}

#Preview("AedstHoverCard") {
    AedstHoverCard {
        Text("@aedst") // i18n-ok: preview
            .font(AedstTypography.body.weight(.medium))
            .underline()
    } card: {
        VStack(alignment: .leading, spacing: AedstSpacing.xs) {
            Text("AEDST") // i18n-ok: preview
                .font(AedstTypography.headline)
            Text("One product, five platforms.") // i18n-ok: preview
                .font(AedstTypography.caption)
                .foregroundStyle(AedstColor.mutedForeground)
        }
    }
    .padding()
}

#endif
