import SwiftUI

// iOS, macOS and visionOS only: tvOS and watchOS are scaffolded package platforms without app targets.
#if os(iOS) || os(macOS) || os(visionOS)

/// Who wrote a turn (web `AiMessageRole`): the person's turn sits at the end in a muted bubble, the agent's and
/// the system's turns are free text at the start.
public enum AedstAiMessageRole: Sendable, CaseIterable {
    case user
    case assistant
    case system

    /// The base message alignment for this role.
    var align: AedstMessageAlign { self == .user ? .end : .start }
}

extension EnvironmentValues {
    /// Role of the enclosing `AedstAiMessage`; `AedstAiMessageContent` reads it.
    @Entry var aedstAiMessageRole: AedstAiMessageRole = .assistant
}

/// One turn of a conversation with an agent, matching shadcn AI Elements `Message` (`AiMessage`): the base
/// `AedstMessage` aligned by role. Compose it from `AedstAiMessageHeader`, `AedstAiMessageContent`
/// (with `AedstAiMessageResponse` for the agent's reply) and `AedstAiMessageActions`.
public struct AedstAiMessage<Content: View>: View {
    private let from: AedstAiMessageRole
    private let content: Content

    public init(from: AedstAiMessageRole, @ViewBuilder content: () -> Content) {
        self.from = from
        self.content = content()
    }

    public var body: some View {
        AedstMessage(align: from.align) {
            content
        }
        .environment(\.aedstAiMessageRole, from)
    }
}

/// Small muted line above a turn: the sender or a time (`AiMessageHeader`).
public struct AedstAiMessageHeader: View {
    private let text: String

    public init(_ text: String) {
        self.text = text
    }

    public var body: some View {
        AedstMessageHeader(text)
    }
}

/// The body of a turn (`AiMessageContent`). On the person's turn the content sits in a muted bubble at the end;
/// otherwise it is a column of free content.
public struct AedstAiMessageContent<Content: View>: View {
    private let content: Content
    @Environment(\.aedstAiMessageRole) private var role

    public init(@ViewBuilder content: () -> Content) {
        self.content = content()
    }

    public var body: some View {
        if role == .user {
            AedstBubble(variant: .muted, align: .end) {
                content
            }
        } else {
            VStack(alignment: .leading, spacing: AedstSpacing.sm) {
                content
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }
}

/// The agent's reply (`AiMessageResponse`), possibly still streaming. Plain selectable text by default, like web;
/// `rendersMarkdown` parses inline Markdown with the platform's `AttributedString` (no extra dependency).
///
/// While `streaming` is true the text is marked as frequently updating and its value says "Loading", the
/// equivalent of web `aria-busy`; announce the finished reply through `AedstAiChat`'s `announcement`.
public struct AedstAiMessageResponse: View, Equatable {
    private let text: String
    private let streaming: Bool
    private let rendersMarkdown: Bool

    /// - Parameters:
    ///   - text: The reply text.
    ///   - streaming: True while the reply streams in.
    ///   - rendersMarkdown: Render inline Markdown (emphasis, code, links); block structure stays as text.
    public init(_ text: String, streaming: Bool = false, rendersMarkdown: Bool = false) {
        self.text = text
        self.streaming = streaming
        self.rendersMarkdown = rendersMarkdown
    }

    public var body: some View {
        Text(Self.content(text, rendersMarkdown: rendersMarkdown))
            .font(AedstTypography.body)
            .foregroundStyle(AedstColor.foreground)
            .textSelection(.enabled)
            .fixedSize(horizontal: false, vertical: true)
            .frame(maxWidth: .infinity, alignment: .leading)
            .accessibilityAddTraits(streaming ? .updatesFrequently : [])
            .accessibilityValue(Text(streaming ? AedstStrings.loading : ""))
    }

    /// The text as an attributed string: parsed inline Markdown when asked and valid, otherwise verbatim.
    static func content(_ text: String, rendersMarkdown: Bool) -> AttributedString {
        guard rendersMarkdown else { return AttributedString(text) }
        let options = AttributedString.MarkdownParsingOptions(interpretedSyntax: .inlineOnlyPreservingWhitespace)
        return (try? AttributedString(markdown: text, options: options)) ?? AttributedString(text)
    }
}

/// Row of actions under a turn (`AiMessageActions`); it follows the message's alignment.
public struct AedstAiMessageActions<Content: View>: View {
    private let content: Content

    public init(@ViewBuilder content: () -> Content) {
        self.content = content()
    }

    public var body: some View {
        HStack(spacing: AedstSpacing.xs) {
            content
        }
    }
}

/// A ghost icon button with a tooltip (`AiMessageAction`): copy, retry, like. Pass `isPressed` for a toggle;
/// VoiceOver then reports it as selected.
public struct AedstAiMessageAction: View {
    private let label: String
    private let systemImage: String
    private let tooltip: String?
    private let showsTooltip: Bool
    private let isPressed: Bool?
    private let action: () -> Void

    /// - Parameters:
    ///   - label: Accessible name, also the tooltip text unless `tooltip` is set.
    ///   - tooltip: Tooltip text when it should differ from `label`.
    ///   - showsTooltip: `false` hides the tooltip (web `tooltip={false}`).
    ///   - isPressed: The toggle state, or `nil` for a plain action.
    public init(
        _ label: String,
        systemImage: String,
        tooltip: String? = nil,
        showsTooltip: Bool = true,
        isPressed: Bool? = nil,
        action: @escaping () -> Void
    ) {
        self.label = label
        self.systemImage = systemImage
        self.tooltip = tooltip
        self.showsTooltip = showsTooltip
        self.isPressed = isPressed
        self.action = action
    }

    public var body: some View {
        let button = AedstIconButton(systemImage: systemImage, accessibilityLabel: label, variant: .ghost, size: .iconSm, action: action)
            .foregroundStyle(isPressed == true ? AedstColor.foreground : AedstColor.mutedForeground)
            .accessibilityAddTraits(isPressed == true ? .isSelected : [])
        if showsTooltip {
            button.aedstTooltip(tooltip ?? label)
        } else {
            button
        }
    }
}

#Preview("AedstAiMessage") {
    VStack(spacing: AedstSpacing.xxl) {
        AedstAiMessage(from: .user) {
            AedstAiMessageContent {
                Text("Summarise the release notes.") // i18n-ok: preview
            }
        }
        AedstAiMessage(from: .assistant) {
            AedstAiMessageContent {
                AedstAiMessageResponse("The release adds **dark mode** and fixes `sync`.", streaming: true, rendersMarkdown: true)
            }
            AedstAiMessageActions {
                AedstAiMessageAction("Copy", systemImage: "doc.on.doc") {}
                AedstAiMessageAction("Like", systemImage: "hand.thumbsup", isPressed: true) {}
            }
        }
    }
    .padding()
}

#endif
