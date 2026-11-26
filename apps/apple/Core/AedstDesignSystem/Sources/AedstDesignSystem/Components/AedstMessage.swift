import SwiftUI

// iOS, macOS and visionOS only: tvOS and watchOS are scaffolded package platforms without app targets.
#if os(iOS) || os(macOS) || os(visionOS)

/// shadcn/ui `Message` `align`: which side of the conversation a message sits on. `end` (usually the current user's
/// messages) puts the avatar on the trailing edge and aligns the content there; both mirror in right-to-left.
public enum AedstMessageAlign: Sendable, CaseIterable {
    case start
    case end

    /// Horizontal alignment of the message's content column.
    var horizontalAlignment: HorizontalAlignment {
        self == .end ? .trailing : .leading
    }

    /// Frame alignment of the whole row and of the header and footer text.
    var frameAlignment: Alignment {
        self == .end ? .trailing : .leading
    }
}

extension EnvironmentValues {
    /// Alignment of the enclosing `AedstMessage`; `AedstBubble` without its own `align` follows it.
    @Entry var aedstMessageAlign: AedstMessageAlign = .start
}

/// One message of a conversation, matching shadcn/ui `Message` + `MessageAvatar` + `MessageContent`: an optional
/// avatar at the bottom of the row and a column of content (bubbles, attachments, a header and a footer).
///
/// VoiceOver reads the content in order; the avatar is part of the row, so give it a label (`AedstAvatar` has one).
public struct AedstMessage<Avatar: View, Content: View>: View {
    private let align: AedstMessageAlign
    private let avatar: Avatar
    private let content: Content

    /// - Parameters:
    ///   - align: `.start` for others' messages, `.end` for the current user's.
    ///   - content: The message's parts, top to bottom (`AedstMessageHeader`, `AedstBubble`, `AedstMessageFooter`).
    ///   - avatar: Shown beside the last line of the message (`MessageAvatar`).
    public init(
        align: AedstMessageAlign = .start,
        @ViewBuilder content: () -> Content,
        @ViewBuilder avatar: () -> Avatar
    ) {
        self.align = align
        self.avatar = avatar()
        self.content = content()
    }

    public var body: some View {
        HStack(alignment: .bottom, spacing: AedstSpacing.sm) {
            if align == .end {
                Spacer(minLength: AedstSpacing.none)
                column
                avatarSlot
            } else {
                avatarSlot
                column
                Spacer(minLength: AedstSpacing.none)
            }
        }
        .frame(maxWidth: .infinity, alignment: align.frameAlignment)
        .environment(\.aedstMessageAlign, align)
        .accessibilityElement(children: .contain)
    }

    private var column: some View {
        VStack(alignment: align.horizontalAlignment, spacing: AedstSpacing.sm + AedstSpacing.xxs) {
            content
        }
    }

    @ViewBuilder private var avatarSlot: some View {
        if Avatar.self != EmptyView.self {
            avatar
                .frame(minWidth: AedstSpacing.xxxl)
        }
    }
}

extension AedstMessage where Avatar == EmptyView {
    /// A message without an avatar.
    public init(align: AedstMessageAlign = .start, @ViewBuilder content: () -> Content) {
        self.init(align: align, content: content, avatar: { EmptyView() })
    }
}

/// Consecutive messages from one sender (`MessageGroup`).
public struct AedstMessageGroup<Content: View>: View {
    private let content: Content

    public init(@ViewBuilder content: () -> Content) {
        self.content = content()
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: AedstSpacing.sm) {
            content
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

/// Small muted line above a message: the sender's name or a time (`MessageHeader`).
public struct AedstMessageHeader: View {
    private let text: String

    public init(_ text: String) {
        self.text = text
    }

    public var body: some View {
        AedstMessageCaption(text: text)
    }
}

/// Small muted line under a message: a time, "Read", "Edited" (`MessageFooter`). Aligned with the message.
public struct AedstMessageFooter: View {
    private let text: String

    public init(_ text: String) {
        self.text = text
    }

    public var body: some View {
        AedstMessageCaption(text: text)
    }
}

/// The caption style shared by the header and the footer; the message's content column aligns it.
private struct AedstMessageCaption: View {
    let text: String

    var body: some View {
        Text(text)
            .font(AedstTypography.caption.weight(.medium))
            .foregroundStyle(AedstColor.mutedForeground)
            .lineLimit(1)
            .padding(.horizontal, AedstSpacing.md)
    }
}

#Preview("AedstMessage") {
    AedstMessageGroup {
        AedstMessage {
            AedstMessageHeader("Ada")
            AedstBubble("Did the build pass?", variant: .muted)
        } avatar: {
            AedstAvatar(name: "Ada Lovelace", size: .sm)
        }
        AedstMessage(align: .end) {
            AedstBubble("Yes, all green.")
            AedstMessageFooter("Read")
        }
    }
    .padding()
}

#endif
