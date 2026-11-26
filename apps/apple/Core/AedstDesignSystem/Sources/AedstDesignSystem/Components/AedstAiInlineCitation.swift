import SwiftUI

// iOS, macOS and visionOS only: tvOS and watchOS are scaffolded package platforms without app targets.
#if os(iOS) || os(macOS) || os(visionOS)

/// Helpers shared by `AedstAiInlineCitation` and `AedstAiSources` (web `citationHostname`).
public enum AedstAiCitation {
    /// Host name without `www.`, or the input when it is not a URL with a host.
    public static func hostname(_ url: String) -> String {
        guard let host = URL(string: url)?.host(percentEncoded: false), !host.isEmpty else { return url }
        return host.hasPrefix("www.") ? String(host.dropFirst(4)) : host
    }

    /// The trigger's visible parts: the first source's host and the count of the others.
    static func triggerParts(_ sources: [String]) -> (host: String?, more: Int) {
        (sources.first.map(hostname), max(sources.count - 1, 0))
    }
}

/// A cited sentence, matching shadcn AI Elements `Inline Citation`: the text (`AedstAiInlineCitationText`) and
/// its citation chip (`AedstAiInlineCitationCard`) kept together. Adaptation: SwiftUI text cannot hold a button
/// inline, so the chip follows the last line of the text on the same baseline.
public struct AedstAiInlineCitation<Content: View>: View {
    private let content: Content

    public init(@ViewBuilder content: () -> Content) {
        self.content = content()
    }

    public var body: some View {
        HStack(alignment: .lastTextBaseline, spacing: AedstSpacing.xs) {
            content
        }
    }
}

/// The cited text (`AiInlineCitationText`).
public struct AedstAiInlineCitationText: View {
    private let text: String

    public init(_ text: String) {
        self.text = text
    }

    public var body: some View {
        Text(text)
            .font(AedstTypography.body)
            .foregroundStyle(AedstColor.foreground)
            .fixedSize(horizontal: false, vertical: true)
    }
}

/// The citation chip and its card (`AiInlineCitationCard` + `AiInlineCitationCardTrigger` +
/// `AiInlineCitationCardBody`): a focusable extra-small secondary button showing the first source's host and
/// "+N"; activating it opens the card in a popover (by touch, keyboard, pointer or VoiceOver alike).
public struct AedstAiInlineCitationCard<Card: View>: View {
    private let sources: [String]
    private let moreLabel: String?
    private let card: Card
    @State private var isPresented = false

    /// - Parameters:
    ///   - sources: URLs of the cited sources; the first host name is the visible label.
    ///   - moreLabel: Read after the label instead of "+N", e.g. "and 2 more sources".
    ///   - card: The card's content, usually `AedstAiInlineCitationSource`s and an `AedstAiInlineCitationQuote`.
    public init(sources: [String], moreLabel: String? = nil, @ViewBuilder card: () -> Card) {
        self.sources = sources
        self.moreLabel = moreLabel
        self.card = card()
    }

    public var body: some View {
        let parts = AedstAiCitation.triggerParts(sources)
        let title = parts.more > 0 ? "\(parts.host ?? "") +\(parts.more)" : (parts.host ?? "")
        AedstButton(title, variant: .secondary, size: .xs, fillsWidth: false) { isPresented = true }
            .fixedSize()
            .environment(\.layoutDirection, .leftToRight)
            .accessibilityLabel(Text(Self.spokenLabel(host: parts.host, more: parts.more, moreLabel: moreLabel)))
            .aedstPopover(isPresented: $isPresented, arrowEdge: .bottom) {
                VStack(alignment: .leading, spacing: AedstSpacing.md) {
                    card
                }
                .frame(width: 288, alignment: .leading)
            }
    }

    /// What VoiceOver reads: the host, then `moreLabel` (or "+N" without one).
    static func spokenLabel(host: String?, more: Int, moreLabel: String?) -> String {
        let host = host ?? ""
        guard more > 0 else { return host }
        if let moreLabel, !moreLabel.isEmpty { return "\(host) \(moreLabel)" }
        return "\(host) +\(more)"
    }
}

/// One source in the card (`AiInlineCitationSource`): title (or the host), description and a link that opens the
/// page in the browser.
public struct AedstAiInlineCitationSource: View {
    private let url: URL
    private let title: String?
    private let description: String?
    private let newTabLabel: String?

    /// - Parameters:
    ///   - url: The source page.
    ///   - title: Falls back to the host name.
    ///   - description: Optional summary.
    ///   - newTabLabel: Read after the link, e.g. "(opens in the browser)".
    public init(url: URL, title: String? = nil, description: String? = nil, newTabLabel: String? = nil) {
        self.url = url
        self.title = title
        self.description = description
        self.newTabLabel = newTabLabel
    }

    public var body: some View {
        let host = AedstAiCitation.hostname(url.absoluteString)
        VStack(alignment: .leading, spacing: AedstSpacing.xs) {
            Text(title ?? host)
                .font(AedstTypography.body.weight(.medium))
            if let description {
                Text(description)
                    .font(AedstTypography.body)
                    .foregroundStyle(AedstColor.mutedForeground)
                    .fixedSize(horizontal: false, vertical: true)
            }
            Link(destination: url) {
                Text(host)
                    .font(AedstTypography.caption)
                    .foregroundStyle(AedstColor.mutedForeground)
                    .underline()
                    .environment(\.layoutDirection, .leftToRight)
            }
            .accessibilityLabel(Text([host, newTabLabel].compactMap(\.self).joined(separator: " ")))
            .aedstHitTarget()
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

/// The quoted passage the citation supports (`AiInlineCitationQuote`): italic, muted, with a leading rule that
/// mirrors in right-to-left.
public struct AedstAiInlineCitationQuote: View {
    private let text: String

    public init(_ text: String) {
        self.text = text
    }

    public var body: some View {
        Text(text)
            .font(AedstTypography.body.italic())
            .foregroundStyle(AedstColor.mutedForeground)
            .fixedSize(horizontal: false, vertical: true)
            .padding(.leading, AedstSpacing.md)
            .overlay(alignment: .leading) {
                Rectangle().fill(AedstColor.border).frame(width: 2)
            }
    }
}

#Preview("AedstAiInlineCitation") {
    AedstAiInlineCitation {
        AedstAiInlineCitationText("Swift 6 makes data-race safety the default.")
        AedstAiInlineCitationCard(
            sources: ["https://www.swift.org/blog/swift-6", "https://developer.apple.com/swift"],
            moreLabel: "and 1 more source"
        ) {
            AedstAiInlineCitationSource(
                url: URL(string: "https://www.swift.org/blog/swift-6") ?? URL(filePath: "/"),
                title: "Announcing Swift 6",
                description: "Complete concurrency checking is on by default."
            )
            AedstAiInlineCitationQuote("Swift 6 enables data-race safety by default.")
        }
    }
    .padding()
}

#endif
