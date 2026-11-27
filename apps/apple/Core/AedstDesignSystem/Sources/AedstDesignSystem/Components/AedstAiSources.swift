import SwiftUI

// iOS, macOS and visionOS only: tvOS and watchOS are scaffolded package platforms without app targets.
#if os(iOS) || os(macOS) || os(visionOS)

/// The links the agent used for a reply, matching shadcn AI Elements `Sources`: a line with the count
/// (`AedstAiSourcesTrigger`, worded by the caller: "Used 3 sources") that opens into a list of links
/// (`AedstAiSourcesContent` with `AedstAiSource` rows). Built on the kit's `AedstCollapsible`, so the line is one
/// button whose value says "Expanded" / "Collapsed" and the motion honours Reduce Motion.
public struct AedstAiSources<Label: View, Content: View>: View {
    private let initiallyExpanded: Bool
    private let label: Label
    private let content: Content

    /// - Parameters:
    ///   - initiallyExpanded: Open on first show.
    ///   - label: The line, usually `AedstAiSourcesTrigger`.
    ///   - content: Usually `AedstAiSourcesContent`.
    public init(
        initiallyExpanded: Bool = false,
        @ViewBuilder label: () -> Label,
        @ViewBuilder content: () -> Content
    ) {
        self.initiallyExpanded = initiallyExpanded
        self.label = label()
        self.content = content()
    }

    public var body: some View {
        AedstCollapsible(initiallyExpanded: initiallyExpanded) {
            label
        } content: {
            content
        }
    }
}

/// The line with the count (`AiSourcesTrigger`): a decorative globe (or `systemImage`) and the caller's text.
public struct AedstAiSourcesTrigger: View {
    private let title: String
    private let systemImage: String

    /// - Parameters:
    ///   - title: Already localized, with the count: "Used 3 sources".
    ///   - systemImage: Decorative SF Symbol before the text.
    public init(_ title: String, systemImage: String = "globe") {
        self.title = title
        self.systemImage = systemImage
    }

    public var body: some View {
        HStack(spacing: AedstSpacing.sm) {
            Image(systemName: systemImage)
                .accessibilityHidden(true)
            Text(title)
        }
        .font(AedstTypography.body)
        .foregroundStyle(AedstColor.mutedForeground)
    }
}

/// The list of sources (`AiSourcesContent`), indented under the line.
public struct AedstAiSourcesContent<Content: View>: View {
    private let content: Content

    public init(@ViewBuilder content: () -> Content) {
        self.content = content()
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: AedstSpacing.none) {
            content
        }
        .padding(.leading, AedstSpacing.lg)
        .accessibilityElement(children: .contain)
    }
}

/// One source (`AiSource`): a link that opens in the browser. The text is the title or the host name; the
/// trailing arrow is decorative and mirrors in right-to-left. At least 44 pt tall on touch platforms.
public struct AedstAiSource: View {
    private let href: URL
    private let title: String?
    private let newTabLabel: String?
    private let systemImage: String?

    /// - Parameters:
    ///   - href: The page.
    ///   - title: Link text; falls back to the host name.
    ///   - newTabLabel: Read after the title, e.g. "(opens in the browser)".
    ///   - systemImage: Optional decorative SF Symbol before the text.
    public init(href: URL, title: String? = nil, newTabLabel: String? = nil, systemImage: String? = nil) {
        self.href = href
        self.title = title
        self.newTabLabel = newTabLabel
        self.systemImage = systemImage
    }

    /// The visible text: the title, or the host name of `href`.
    var displayTitle: String { title ?? AedstAiCitation.hostname(href.absoluteString) }

    @Environment(\.dynamicTypeSize) private var dynamicTypeSize

    public var body: some View {
        // Only https, http and mailto are opened (`AedstSafeURL`); any other scheme shows the row as text.
        if let safeURL = AedstSafeURL.validated(href) {
            Link(destination: safeURL) { row }
                .accessibilityLabel(Text([displayTitle, newTabLabel].compactMap(\.self).joined(separator: " ")))
        } else {
            row
                .accessibilityElement(children: .combine)
                .accessibilityLabel(Text(displayTitle))
        }
    }

    private var row: some View {
        HStack(spacing: AedstSpacing.sm) {
            if let systemImage {
                Image(systemName: systemImage)
                    .accessibilityHidden(true)
            }
            Text(displayTitle)
                .lineLimit(AedstLayoutPolicy.lineLimit(1, for: dynamicTypeSize))
                .truncationMode(.tail)
                .frame(maxWidth: .infinity, alignment: .leading)
            Image(systemName: "arrow.up.right")
                .flipsForRightToLeftLayoutDirection(true)
                .accessibilityHidden(true)
        }
        .font(AedstTypography.body)
        .foregroundStyle(AedstColor.mutedForeground)
        .padding(.horizontal, AedstSpacing.sm)
        .padding(.vertical, AedstSpacing.xs + AedstSpacing.xxs)
        .aedstScaledMinFrame(minHeight: 32)
        .aedstHitTarget()
        .contentShape(Rectangle())
    }
}

#Preview("AedstAiSources") {
    AedstAiSources(initiallyExpanded: true) {
        AedstAiSourcesTrigger("Used 2 sources")
    } content: {
        AedstAiSourcesContent {
            AedstAiSource(href: URL(string: "https://www.swift.org/documentation") ?? URL(filePath: "/"))
            AedstAiSource(href: URL(string: "https://developer.apple.com/swiftui") ?? URL(filePath: "/"), title: "SwiftUI")
        }
    }
    .padding()
}

#endif
