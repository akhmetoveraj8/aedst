import SwiftUI

// iOS, macOS and visionOS only: tvOS and watchOS are scaffolded package platforms without app targets.
#if os(iOS) || os(macOS) || os(visionOS)

/// A horizontal row of one-tap prompts above the prompt input, matching shadcn AI Elements `Suggestion`
/// (`AiSuggestions`). The row scrolls sideways when the suggestions do not fit; it mirrors in right-to-left.
/// VoiceOver treats it as one group (web `role="group"`), named by `accessibilityLabel` when given.
public struct AedstAiSuggestions<Content: View>: View {
    private let accessibilityLabel: String?
    private let content: Content

    /// - Parameters:
    ///   - accessibilityLabel: Optional name of the group, e.g. "Suggestions".
    ///   - content: `AedstAiSuggestion` buttons.
    public init(accessibilityLabel: String? = nil, @ViewBuilder content: () -> Content) {
        self.accessibilityLabel = accessibilityLabel
        self.content = content()
    }

    public var body: some View {
        ScrollView(.horizontal) {
            HStack(spacing: AedstSpacing.sm) {
                content
            }
            .padding(.vertical, AedstSpacing.xxs)
        }
        .scrollIndicators(.hidden)
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text(accessibilityLabel ?? ""))
    }
}

/// One suggestion (`AiSuggestion`): a small outline button whose title is the prompt; `onSelect` receives the
/// suggestion text, ready to send.
public struct AedstAiSuggestion: View {
    private let suggestion: String
    private let title: String?
    private let variant: AedstButtonVariant
    private let onSelect: (String) -> Void

    /// - Parameters:
    ///   - suggestion: The prompt text: the visible title (unless `title` is set) and the value passed on.
    ///   - title: A shorter visible title (web `children`); VoiceOver reads it.
    ///   - variant: Button variant; outline as on web.
    ///   - onSelect: Called with `suggestion`.
    public init(
        _ suggestion: String,
        title: String? = nil,
        variant: AedstButtonVariant = .outline,
        onSelect: @escaping (String) -> Void
    ) {
        self.suggestion = suggestion
        self.title = title
        self.variant = variant
        self.onSelect = onSelect
    }

    /// The visible title: `title` when given, otherwise the suggestion itself.
    var displayTitle: String { title ?? suggestion }

    public var body: some View {
        AedstButton(displayTitle, variant: variant, size: .sm, fillsWidth: false) {
            onSelect(suggestion)
        }
        .fixedSize()
    }
}

#Preview("AedstAiSuggestion") {
    @Previewable @State var sent = ""
    VStack(alignment: .leading, spacing: AedstSpacing.md) {
        AedstAiSuggestions(accessibilityLabel: "Suggestions") {
            ForEach(["What can you do?", "Summarise my week", "Draft a reply", "Plan a trip"], id: \.self) { text in
                AedstAiSuggestion(text) { sent = $0 }
            }
        }
        Text(sent)
    }
    .padding()
}

#endif
