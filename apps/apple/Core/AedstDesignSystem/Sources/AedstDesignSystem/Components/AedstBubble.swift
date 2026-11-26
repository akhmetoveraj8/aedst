import SwiftUI

// iOS, macOS and visionOS only: tvOS and watchOS are scaffolded package platforms without app targets.
#if os(iOS) || os(macOS) || os(visionOS)

/// shadcn/ui `Bubble` `variant`: the fill and text color of the bubble's content.
public enum AedstBubbleVariant: Sendable, CaseIterable {
    case `default`
    case secondary
    case muted
    /// A light wash of the primary color (web mixes it in OKLCH; here it is `primary` at low opacity).
    case tinted
    case outline
    /// No chrome at all, full width: for long assistant replies.
    case ghost
    case destructive

    var fill: Color {
        switch self {
        case .default: AedstColor.primary
        case .secondary: AedstColor.secondary
        case .muted: AedstColor.muted
        case .tinted: AedstColor.primary.opacity(0.12)
        case .outline: AedstColor.background
        case .ghost: .clear
        case .destructive: AedstColor.destructive.opacity(0.1)
        }
    }

    var foreground: Color {
        switch self {
        case .default: AedstColor.primaryForeground
        case .secondary: AedstColor.secondaryForeground
        case .muted, .tinted, .outline, .ghost: AedstColor.foreground
        case .destructive: AedstColor.destructive
        }
    }

    /// Only `outline` draws a border.
    var hasBorder: Bool { self == .outline }

    /// Padding around the content (web `px-3 py-2`; none for `ghost`).
    var insets: EdgeInsets {
        self == .ghost
            ? EdgeInsets()
            : EdgeInsets(top: AedstSpacing.sm, leading: AedstSpacing.md, bottom: AedstSpacing.sm, trailing: AedstSpacing.md)
    }

    var cornerRadius: CGFloat { self == .ghost ? AedstSpacing.none : AedstRadius.xl }

    /// Share of the row a bubble may take (web `max-w-[80%]`, `ghost` the full width).
    var maxWidthFraction: CGFloat { self == .ghost ? 1 : 0.8 }
}

/// shadcn/ui `BubbleReactions` `side`: above or below the bubble's edge.
public enum AedstBubbleSide: Sendable, CaseIterable {
    case top
    case bottom
}

/// shadcn/ui `Bubble` and `BubbleReactions` `align`: the leading (`start`) or trailing (`end`) side.
public enum AedstBubbleAlign: Sendable, CaseIterable {
    case start
    case end

    var horizontal: HorizontalAlignment { self == .end ? .trailing : .leading }

    init(_ message: AedstMessageAlign) {
        self = message == .end ? .end : .start
    }

    /// Corner of the bubble a reactions pill is pinned to.
    static func reactionsAlignment(side: AedstBubbleSide, align: AedstBubbleAlign) -> Alignment {
        switch (side, align) {
        case (.top, .start): .topLeading
        case (.top, .end): .topTrailing
        case (.bottom, .start): .bottomLeading
        case (.bottom, .end): .bottomTrailing
        }
    }
}

/// A chat bubble matching shadcn/ui `Bubble` + `BubbleContent`. Inside an `AedstMessage` it follows the message's
/// alignment unless `align` is given. Text in it is selectable.
public struct AedstBubble<Content: View>: View {
    private let variant: AedstBubbleVariant
    private let align: AedstBubbleAlign?
    private let content: Content
    @Environment(\.aedstMessageAlign) private var messageAlign

    /// - Parameters:
    ///   - variant: Fill and text color.
    ///   - align: Side of the row; `nil` follows the enclosing `AedstMessage`.
    ///   - content: The bubble's content (`BubbleContent`).
    public init(
        variant: AedstBubbleVariant = .default,
        align: AedstBubbleAlign? = nil,
        @ViewBuilder content: () -> Content
    ) {
        self.variant = variant
        self.align = align
        self.content = content()
    }

    public var body: some View {
        let side = align ?? AedstBubbleAlign(messageAlign)
        content
            .textSelection(.enabled)
            .font(AedstTypography.body)
            .foregroundStyle(variant.foreground)
            .padding(variant.insets)
            .background(variant.fill, in: RoundedRectangle(cornerRadius: variant.cornerRadius, style: .continuous))
            .overlay {
                if variant.hasBorder {
                    RoundedRectangle(cornerRadius: variant.cornerRadius, style: .continuous)
                        .strokeBorder(AedstColor.border, lineWidth: 1)
                }
            }
            .containerRelativeFrame(.horizontal, alignment: Alignment(horizontal: side.horizontal, vertical: .center)) { length, _ in
                length * variant.maxWidthFraction
            }
            .frame(maxWidth: .infinity, alignment: Alignment(horizontal: side.horizontal, vertical: .center))
    }
}

extension AedstBubble where Content == Text {
    /// A bubble with selectable text.
    public init(_ text: String, variant: AedstBubbleVariant = .default, align: AedstBubbleAlign? = nil) {
        self.init(variant: variant, align: align) {
            Text(text)
        }
    }
}

/// Bubbles sent in a row (`BubbleGroup`).
public struct AedstBubbleGroup<Content: View>: View {
    private let content: Content
    @Environment(\.aedstMessageAlign) private var messageAlign

    public init(@ViewBuilder content: () -> Content) {
        self.content = content()
    }

    public var body: some View {
        VStack(alignment: AedstBubbleAlign(messageAlign).horizontal, spacing: AedstSpacing.sm) {
            content
        }
    }
}

/// The small pill of reactions on a bubble's edge (`BubbleReactions`), e.g. emoji counts.
public struct AedstBubbleReactions<Content: View>: View {
    private let content: Content

    public init(@ViewBuilder content: () -> Content) {
        self.content = content()
    }

    public var body: some View {
        HStack(spacing: AedstSpacing.xs) {
            content
        }
        .font(AedstTypography.caption)
        .padding(.horizontal, AedstSpacing.xs + AedstSpacing.xxs)
        .padding(.vertical, AedstSpacing.xxs)
        .background(AedstColor.muted, in: Capsule())
        .overlay { Capsule().strokeBorder(AedstColor.card, lineWidth: 3) }
    }
}

extension View {
    /// Pins reactions to a corner of a bubble, three quarters outside its edge (`BubbleReactions` `side`/`align`).
    public func aedstBubbleReactions<Reactions: View>(
        side: AedstBubbleSide = .bottom,
        align: AedstBubbleAlign = .end,
        @ViewBuilder reactions: () -> Reactions
    ) -> some View {
        let pill = AedstBubbleReactions(content: reactions)
        return overlay(alignment: AedstBubbleAlign.reactionsAlignment(side: side, align: align)) {
            pill
                .padding(.horizontal, AedstSpacing.md)
                .alignmentGuide(VerticalAlignment.top) { $0[VerticalAlignment.top] + $0.height * 0.75 }
                .alignmentGuide(VerticalAlignment.bottom) { $0[VerticalAlignment.bottom] - $0.height * 0.75 }
        }
    }
}

#Preview("AedstBubble") {
    ScrollView {
        VStack(spacing: AedstSpacing.lg) {
            ForEach(AedstBubbleVariant.allCases, id: \.self) { variant in
                AedstBubble("A \(String(describing: variant)) bubble", variant: variant) // i18n-ok: preview
            }
            AedstBubble("Sent by me", align: .end)
                .aedstBubbleReactions(side: .bottom, align: .end) {
                    Text(verbatim: "👍 2")
                }
        }
        .padding()
    }
}

#endif
