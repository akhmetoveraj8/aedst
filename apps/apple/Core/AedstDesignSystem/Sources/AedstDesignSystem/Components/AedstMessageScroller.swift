import SwiftUI

// iOS, macOS and visionOS only: tvOS and watchOS are scaffolded package platforms without app targets.
#if os(iOS) || os(macOS) || os(visionOS)

/// The scrolling rules of `AedstMessageScroller`, as pure functions so they are unit-tested.
enum AedstMessageScrollerPolicy {
    /// Within this distance (pt) of the end the list counts as "at the latest message".
    static let endThreshold: CGFloat = 24

    /// Distance from the visible bottom edge to the end of the content.
    static func distanceToEnd(contentHeight: CGFloat, offsetY: CGFloat, visibleHeight: CGFloat, bottomInset: CGFloat = 0) -> CGFloat {
        max(0, contentHeight + bottomInset - (offsetY + visibleHeight))
    }

    static func isAtEnd(distanceToEnd: CGFloat) -> Bool {
        distanceToEnd <= endThreshold
    }

    /// What to say when the item list changes from `previousLastID` to `lastID`: nothing for the first load, for the
    /// same last item, or while it is still streaming (it is announced once complete); otherwise the caller's text,
    /// or "New message" when the user is not looking at the end.
    static func announcement<ID: Equatable>(
        previousLastID: ID?,
        lastID: ID?,
        isStreaming: Bool,
        isAtEnd: Bool,
        text: String?
    ) -> String? {
        guard let lastID, let previousLastID, lastID != previousLastID, !isStreaming else { return nil }
        if let text, !text.isEmpty { return text }
        return isAtEnd ? nil : AedstStrings.newMessage
    }
}

/// A conversation list that sticks to the newest message, matching shadcn/ui `MessageScroller` (`Viewport`,
/// `Content`, `Item`, `Button`): it opens at the end, follows new messages and a streaming reply while the user is
/// at the end, stops following as soon as the user scrolls up, and shows a "Scroll to end" button until they return.
///
/// Rows are lazy (`LazyVStack`), so long histories stay cheap. Accessibility: the list is a named region
/// ("Messages"), a completed message is announced through `announcement` (or "New message" while the user is
/// reading older ones), and the jump respects Reduce Motion.
public struct AedstMessageScroller<Item: Identifiable, Row: View>: View {
    private let items: [Item]
    private let isStreaming: Bool
    private let accessibilityLabel: String?
    private let scrollToEndLabel: String?
    private let announcement: ((Item) -> String?)?
    private let row: (Item) -> Row

    @State private var position = ScrollPosition(edge: .bottom)
    @State private var isFollowing = true
    @State private var isAtEnd = true
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    /// - Parameters:
    ///   - items: Messages, oldest first.
    ///   - isStreaming: The last message is still growing (a streamed reply); it is announced when this turns false.
    ///   - accessibilityLabel: Name of the region; `nil` uses the localized "Messages".
    ///   - scrollToEndLabel: Label of the jump button; `nil` uses the localized "Scroll to end".
    ///   - announcement: Text VoiceOver speaks for a newly completed message (`nil` from the closure: say nothing,
    ///     e.g. for the user's own message).
    ///   - row: One message (`MessageScrollerItem`), usually an `AedstMessage`.
    public init(
        _ items: [Item],
        isStreaming: Bool = false,
        accessibilityLabel: String? = nil,
        scrollToEndLabel: String? = nil,
        announcement: ((Item) -> String?)? = nil,
        @ViewBuilder row: @escaping (Item) -> Row
    ) {
        self.items = items
        self.isStreaming = isStreaming
        self.accessibilityLabel = accessibilityLabel
        self.scrollToEndLabel = scrollToEndLabel
        self.announcement = announcement
        self.row = row
    }

    public var body: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: AedstSpacing.xxl) {
                ForEach(items) { item in
                    row(item)
                }
            }
            .scrollTargetLayout()
            .padding(AedstSpacing.md)
        }
        .scrollPosition($position)
        .defaultScrollAnchor(.bottom, for: .initialOffset)
        .onScrollGeometryChange(for: CGFloat.self) { geometry in
            AedstMessageScrollerPolicy.distanceToEnd(
                contentHeight: geometry.contentSize.height,
                offsetY: geometry.contentOffset.y,
                visibleHeight: geometry.containerSize.height,
                bottomInset: geometry.contentInsets.bottom
            )
        } action: { _, distance in
            isAtEnd = AedstMessageScrollerPolicy.isAtEnd(distanceToEnd: distance)
            // New or streamed content pushed the end away while following: stay with it, without animation.
            if isFollowing, !isAtEnd { position.scrollTo(edge: .bottom) }
        }
        .onScrollPhaseChange { _, phase, context in
            // The user takes over while dragging; following resumes only if they let go at the end.
            if phase == .interacting { isFollowing = false }
            if phase == .idle {
                let geometry = context.geometry
                isFollowing = AedstMessageScrollerPolicy.isAtEnd(
                    distanceToEnd: AedstMessageScrollerPolicy.distanceToEnd(
                        contentHeight: geometry.contentSize.height,
                        offsetY: geometry.contentOffset.y,
                        visibleHeight: geometry.containerSize.height,
                        bottomInset: geometry.contentInsets.bottom
                    )
                )
            }
        }
        .onChange(of: items.last?.id) { previous, current in
            announce(previousLastID: previous, lastID: current, isStreaming: isStreaming)
        }
        .onChange(of: isStreaming) { wasStreaming, streaming in
            // A streamed reply is spoken once, when it is complete.
            if wasStreaming, !streaming, let last = items.last, let text = announcement?(last) {
                AedstAnnouncer.post(text)
            }
        }
        .overlay(alignment: .bottom) { jumpButton }
        .aedstAnimation(.easeOut(duration: AedstMotion.durationNormal), value: isAtEnd)
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text(accessibilityLabel ?? AedstStrings.messages))
    }

    private func announce(previousLastID: Item.ID?, lastID: Item.ID?, isStreaming: Bool) {
        let text = items.last.flatMap { announcement?($0) }
        if let spoken = AedstMessageScrollerPolicy.announcement(
            previousLastID: previousLastID,
            lastID: lastID,
            isStreaming: isStreaming,
            isAtEnd: isAtEnd,
            text: text
        ) {
            AedstAnnouncer.post(spoken)
        }
    }

    @ViewBuilder private var jumpButton: some View {
        if !isAtEnd {
            AedstIconButton(
                systemImage: "arrow.down",
                accessibilityLabel: scrollToEndLabel ?? AedstStrings.scrollToEnd,
                variant: .secondary,
                size: .iconSm
            ) {
                isFollowing = true
                withAnimation(reduceMotion ? nil : .easeOut(duration: AedstMotion.durationSlow)) {
                    position.scrollTo(edge: .bottom)
                }
            }
            .overlay { Circle().strokeBorder(AedstColor.border, lineWidth: 1).allowsHitTesting(false) }
            .padding(.bottom, AedstSpacing.lg)
            .transition(reduceMotion ? .opacity : .scale(scale: 0.95).combined(with: .opacity))
        }
    }
}

/// A preview row.
private struct AedstPreviewLine: Identifiable {
    let id: Int
    let text: String
}

#Preview("AedstMessageScroller") {
    @Previewable @State var lines = (1...20).map { AedstPreviewLine(id: $0, text: "Message number \($0)") }
    VStack {
        AedstMessageScroller(lines, announcement: { $0.text }) { line in
            AedstMessage(align: line.id.isMultiple(of: 3) ? .end : .start) {
                AedstBubble(line.text, variant: line.id.isMultiple(of: 3) ? .default : .muted)
            }
        }
        .frame(height: 320)
        AedstButton("Add message") { lines.append(AedstPreviewLine(id: lines.count + 1, text: "Message number \(lines.count + 1)")) }
    }
    .padding()
}

#endif
