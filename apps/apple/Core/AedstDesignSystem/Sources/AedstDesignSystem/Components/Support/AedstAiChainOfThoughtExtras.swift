import SwiftUI

// iOS, macOS and visionOS only: tvOS and watchOS are scaffolded package platforms without app targets.
#if os(iOS) || os(macOS) || os(visionOS)

/// The sources a chain-of-thought step looked at, as wrapping badges (web `AiChainOfThoughtSearchResults`).
public struct AedstAiChainOfThoughtSearchResults<Content: View>: View {
    private let content: Content

    public init(@ViewBuilder content: () -> Content) {
        self.content = content()
    }

    public var body: some View {
        AedstAiFlowLayout {
            content
        }
        .accessibilityElement(children: .contain)
    }
}

extension AedstAiChainOfThoughtSearchResults where Content == ForEach<[String], String, AedstAiChainOfThoughtSearchResult> {
    /// One badge per host name.
    public init(_ hosts: [String]) {
        self.init {
            ForEach(hosts, id: \.self) { AedstAiChainOfThoughtSearchResult($0) }
        }
    }
}

/// One source; host names stay left-to-right in right-to-left layouts.
public struct AedstAiChainOfThoughtSearchResult: View {
    private let text: String
    private let variant: AedstBadgeVariant

    public init(_ text: String, variant: AedstBadgeVariant = .secondary) {
        self.text = text
        self.variant = variant
    }

    public var body: some View {
        AedstBadge(text, variant: variant)
            .environment(\.layoutDirection, .leftToRight)
    }
}

/// An image a step produced, with an optional caption; the image itself is the caller's view.
public struct AedstAiChainOfThoughtImage<Content: View>: View {
    private let caption: String?
    private let content: Content

    public init(caption: String? = nil, @ViewBuilder content: () -> Content) {
        self.caption = caption
        self.content = content()
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: AedstSpacing.xs) {
            content
                .background(AedstColor.muted)
                .clipShape(RoundedRectangle(cornerRadius: AedstRadius.lg, style: .continuous))
            if let caption {
                Text(caption)
                    .font(AedstTypography.caption)
                    .foregroundStyle(AedstColor.mutedForeground)
            }
        }
        .accessibilityElement(children: .combine)
    }
}

#endif
