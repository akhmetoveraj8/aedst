import SwiftUI

// iOS, macOS and visionOS only: tvOS and watchOS are scaffolded package platforms without app targets.
#if os(iOS) || os(macOS) || os(visionOS)

/// The thread of a conversation with an agent, matching shadcn AI Elements `Chat` (`AiChat`, `AiChatContent`,
/// `AiChatScrollButton`): the base `AedstMessageScroller` with the turn spacing of web (`gap-6`).
///
/// It opens at the newest turn, follows a streaming reply while the person is at the live edge, and shows the
/// "scroll to latest" button (`scrollToEndLabel`) once they scroll up. `busy` is web `aria-busy`: while a reply
/// is submitted or streaming nothing is announced; the finished turn is spoken once through `announcement`.
/// Deliberate adaptation: the newest turn, not the person's question, is the scroll anchor (the base scroller's
/// live-edge rule), so a short question and its reply stay together at the bottom.
///
/// Show `AedstAiChatEmptyState` instead while there are no turns.
public struct AedstAiChat<Item: Identifiable, Row: View>: View {
    private let items: [Item]
    private let busy: Bool
    private let accessibilityLabel: String?
    private let scrollToEndLabel: String?
    private let announcement: ((Item) -> String?)?
    private let row: (Item) -> Row

    /// - Parameters:
    ///   - items: Turns, oldest first.
    ///   - busy: A reply is submitted or streaming (web `busy`).
    ///   - accessibilityLabel: Name of the thread region; `nil` uses the localized "Messages".
    ///   - scrollToEndLabel: Accessible name of the jump button (web `AiChatScrollButton` `label`).
    ///   - announcement: Text spoken for a newly completed turn; return `nil` for the person's own turn.
    ///   - row: One turn, usually an `AedstAiChatItem` wrapping an `AedstAiMessage`.
    public init(
        _ items: [Item],
        busy: Bool = false,
        accessibilityLabel: String? = nil,
        scrollToEndLabel: String? = nil,
        announcement: ((Item) -> String?)? = nil,
        @ViewBuilder row: @escaping (Item) -> Row
    ) {
        self.items = items
        self.busy = busy
        self.accessibilityLabel = accessibilityLabel
        self.scrollToEndLabel = scrollToEndLabel
        self.announcement = announcement
        self.row = row
    }

    public var body: some View {
        AedstMessageScroller(
            items,
            isStreaming: busy,
            accessibilityLabel: accessibilityLabel,
            scrollToEndLabel: scrollToEndLabel,
            announcement: announcement,
            row: row
        )
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

/// One turn in the thread (`AiChatItem`). The person's turns slide in from below when they are inserted inside
/// `withAnimation`; with Reduce Motion on they only fade.
public struct AedstAiChatItem<Content: View>: View {
    private let from: AedstAiMessageRole
    private let content: Content
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    public init(from: AedstAiMessageRole, @ViewBuilder content: () -> Content) {
        self.from = from
        self.content = content()
    }

    public var body: some View {
        content
            .frame(maxWidth: .infinity)
            .transition(AedstAiChatPolicy.insertion(for: from, reduceMotion: reduceMotion))
    }
}

/// Shown instead of the thread before the first turn (`AiChatEmptyState`): the kit's `AedstEmpty` with an icon
/// tile, centred in the space of the thread.
public struct AedstAiChatEmptyState<Actions: View>: View {
    private let title: String
    private let description: String?
    private let systemImage: String?
    private let actions: Actions

    /// - Parameters:
    ///   - title: Already localized title, e.g. "Start a conversation".
    ///   - description: Optional hint under the title.
    ///   - systemImage: Decorative SF Symbol on a muted tile.
    ///   - actions: Optional content under the text, e.g. `AedstAiSuggestions`.
    public init(
        _ title: String,
        description: String? = nil,
        systemImage: String? = nil,
        @ViewBuilder actions: () -> Actions
    ) {
        self.title = title
        self.description = description
        self.systemImage = systemImage
        self.actions = actions()
    }

    public var body: some View {
        AedstEmpty(title, description: description, systemImage: systemImage, variant: .icon) {
            actions
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

extension AedstAiChatEmptyState where Actions == EmptyView {
    /// An empty state without actions.
    public init(_ title: String, description: String? = nil, systemImage: String? = nil) {
        self.init(title, description: description, systemImage: systemImage) { EmptyView() }
    }
}

/// The motion rules of the chat, as pure functions so they are unit-tested.
enum AedstAiChatPolicy {
    /// Only the person's turns move; the agent's reply streams in place.
    static func slidesIn(_ role: AedstAiMessageRole, reduceMotion: Bool) -> Bool {
        role == .user && !reduceMotion
    }

    static func insertion(for role: AedstAiMessageRole, reduceMotion: Bool) -> AnyTransition {
        slidesIn(role, reduceMotion: reduceMotion) ? .move(edge: .bottom).combined(with: .opacity) : .opacity
    }
}

/// A preview turn.
private struct AedstPreviewTurn: Identifiable {
    let id: Int
    let from: AedstAiMessageRole
    let text: String
}

#Preview("AedstAiChat") {
    @Previewable @State var turns = [
        AedstPreviewTurn(id: 1, from: .user, text: "What changed in v2?"),
        AedstPreviewTurn(id: 2, from: .assistant, text: "Version 2 adds offline sync and a new editor."),
    ]
    VStack {
        AedstAiChat(turns, scrollToEndLabel: "Scroll to latest message", announcement: { $0.from == .user ? nil : $0.text }) { turn in
            AedstAiChatItem(from: turn.from) {
                AedstAiMessage(from: turn.from) {
                    AedstAiMessageContent {
                        if turn.from == .user {
                            Text(turn.text)
                        } else {
                            AedstAiMessageResponse(turn.text)
                        }
                    }
                }
            }
        }
        AedstAiChatEmptyState("Start a conversation", description: "Ask about your projects.", systemImage: "bubble.left.and.bubble.right")
            .frame(height: 200)
    }
    .frame(height: 520)
}

#endif
