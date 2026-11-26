import SwiftUI

// iOS, macOS and visionOS only: tvOS and watchOS are scaffolded package platforms without app targets.
#if os(iOS) || os(macOS) || os(visionOS)

/// Pure rules of `AedstAiReasoning`, unit-tested.
enum AedstAiReasoningLogic {
    /// The controlled state wins, then the user's own choice, then the streaming behaviour (open while thinking).
    static func isOpen(controlled: Bool?, userChoice: Bool?, isStreaming: Bool) -> Bool {
        controlled ?? userChoice ?? isStreaming
    }

    static func title(isStreaming: Bool, thinkingLabel: String, thoughtLabel: String) -> String {
        isStreaming ? thinkingLabel : thoughtLabel
    }

    /// What to announce when streaming changes: the new title, and nothing on the first render or no change.
    static func announcement(wasStreaming: Bool?, isStreaming: Bool, thinkingLabel: String, thoughtLabel: String) -> String? {
        guard let wasStreaming, wasStreaming != isStreaming else { return nil }
        return title(isStreaming: isStreaming, thinkingLabel: thinkingLabel, thoughtLabel: thoughtLabel)
    }
}

/// Model reasoning as one collapsible line, matching the web `AiReasoning`: it opens while the model thinks and
/// closes when it finishes, unless the user opened or closed it (or the caller controls it). The switch from
/// thinking to done is announced to VoiceOver (the web polite live region).
public struct AedstAiReasoning<Content: View>: View {
    private let isStreaming: Bool
    private let controlled: Binding<Bool>?
    private let thinkingLabel: String
    private let thoughtLabel: String
    private let systemImage: String
    private let onExpandedChange: ((Bool) -> Void)?
    private let content: Content
    @State private var userChoice: Bool?
    @State private var wasStreaming: Bool?

    /// - Parameters:
    ///   - isStreaming: The model is still thinking: the line opens and shows a spinner.
    ///   - isExpanded: Controlled open state; wins over the streaming behaviour.
    ///   - initiallyExpanded: Initial user choice; without it the panel follows `isStreaming`.
    ///   - thinkingLabel: Title while streaming ("Thinking").
    ///   - thoughtLabel: Title once finished ("Thought for 5 s"; the caller formats the duration).
    public init(
        isStreaming: Bool = false,
        isExpanded: Binding<Bool>? = nil,
        initiallyExpanded: Bool? = nil,
        thinkingLabel: String,
        thoughtLabel: String,
        systemImage: String = "brain",
        onExpandedChange: ((Bool) -> Void)? = nil,
        @ViewBuilder content: () -> Content
    ) {
        self.isStreaming = isStreaming
        self.controlled = isExpanded
        self.thinkingLabel = thinkingLabel
        self.thoughtLabel = thoughtLabel
        self.systemImage = systemImage
        self.onExpandedChange = onExpandedChange
        self.content = content()
        self._userChoice = State(initialValue: initiallyExpanded)
    }

    private var openBinding: Binding<Bool> {
        Binding(
            get: {
                AedstAiReasoningLogic.isOpen(
                    controlled: controlled?.wrappedValue, userChoice: userChoice, isStreaming: isStreaming
                )
            },
            set: { next in
                userChoice = next
                controlled?.wrappedValue = next
                onExpandedChange?(next)
            }
        )
    }

    public var body: some View {
        AedstAiChainOfThought(isExpanded: openBinding) {
            AedstAiReasoningTrigger(
                isStreaming: isStreaming, thinkingLabel: thinkingLabel, thoughtLabel: thoughtLabel,
                systemImage: systemImage
            )
        } content: {
            content
        }
        .onChange(of: isStreaming, initial: true) { _, current in
            let text = AedstAiReasoningLogic.announcement(
                wasStreaming: wasStreaming, isStreaming: current, thinkingLabel: thinkingLabel, thoughtLabel: thoughtLabel
            )
            wasStreaming = current
            if let text {
                AedstAnnouncer.post(text)
            }
        }
    }
}

extension AedstAiReasoning where Content == AedstAiReasoningContent {
    /// Reasoning given as plain text.
    public init(
        _ text: String,
        isStreaming: Bool = false,
        isExpanded: Binding<Bool>? = nil,
        initiallyExpanded: Bool? = nil,
        thinkingLabel: String,
        thoughtLabel: String,
        systemImage: String = "brain",
        onExpandedChange: ((Bool) -> Void)? = nil
    ) {
        self.init(
            isStreaming: isStreaming, isExpanded: isExpanded, initiallyExpanded: initiallyExpanded,
            thinkingLabel: thinkingLabel, thoughtLabel: thoughtLabel, systemImage: systemImage,
            onExpandedChange: onExpandedChange
        ) {
            AedstAiReasoningContent(text)
        }
    }
}

/// The title line: "Thinking" with a spinner while streaming, the finished label otherwise.
public struct AedstAiReasoningTrigger: View {
    private let isStreaming: Bool
    private let thinkingLabel: String
    private let thoughtLabel: String
    private let systemImage: String

    public init(isStreaming: Bool, thinkingLabel: String, thoughtLabel: String, systemImage: String = "brain") {
        self.isStreaming = isStreaming
        self.thinkingLabel = thinkingLabel
        self.thoughtLabel = thoughtLabel
        self.systemImage = systemImage
    }

    public var body: some View {
        AedstAiChainOfThoughtHeader(
            AedstAiReasoningLogic.title(isStreaming: isStreaming, thinkingLabel: thinkingLabel, thoughtLabel: thoughtLabel),
            systemImage: systemImage,
            status: isStreaming ? .running : nil
        )
        .accessibilityAddTraits(isStreaming ? .updatesFrequently : [])
    }
}

/// The reasoning text, muted, line breaks kept. Markdown rendering is the caller's.
public struct AedstAiReasoningContent: View {
    private let text: String

    public init(_ text: String) {
        self.text = text
    }

    public var body: some View {
        Text(text)
            .font(AedstTypography.body)
            .foregroundStyle(AedstColor.mutedForeground)
            .multilineTextAlignment(.leading)
            .frame(maxWidth: .infinity, alignment: .leading)
            .textSelection(.enabled)
    }
}

#Preview("AedstAiReasoning") {
    @Previewable @State var isStreaming = true
    VStack(alignment: .leading, spacing: AedstSpacing.lg) {
        AedstAiReasoning(
            "The user asks for a summary.\nFirst I list the sections, then I shorten each one.",
            isStreaming: isStreaming,
            thinkingLabel: "Thinking",
            thoughtLabel: "Thought for 5 s"
        )
        AedstButton(isStreaming ? "Finish" : "Stream again", variant: .outline, fillsWidth: false) {
            isStreaming.toggle()
        }
    }
    .padding()
}

#endif
