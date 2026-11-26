import SwiftUI

// iOS, macOS and visionOS only: tvOS and watchOS are scaffolded package platforms without app targets.
#if os(iOS) || os(macOS) || os(visionOS)

/// Token breakdown of a conversation (web `AiContextUsage`); a missing count hides its row.
public struct AedstAiContextUsage: Hashable, Sendable {
    public var inputTokens: Int?
    public var outputTokens: Int?
    public var reasoningTokens: Int?
    public var cachedInputTokens: Int?

    public init(inputTokens: Int? = nil, outputTokens: Int? = nil, reasoningTokens: Int? = nil, cachedInputTokens: Int? = nil) {
        self.inputTokens = inputTokens
        self.outputTokens = outputTokens
        self.reasoningTokens = reasoningTokens
        self.cachedInputTokens = cachedInputTokens
    }
}

/// The values every part of `AedstAiContext` reads, plus the number formatting (pure, so it is unit-tested).
public struct AedstAiContextValue: Hashable, Sendable {
    public let usedTokens: Int
    public let maxTokens: Int
    public let usage: AedstAiContextUsage?

    public init(usedTokens: Int, maxTokens: Int, usage: AedstAiContextUsage? = nil) {
        self.usedTokens = usedTokens
        self.maxTokens = maxTokens
        self.usage = usage
    }

    /// Share of the window used, 0...1, clamped; 0 when the window is unknown.
    public var ratio: Double {
        guard maxTokens > 0 else { return 0 }
        return min(max(Double(usedTokens) / Double(maxTokens), 0), 1)
    }

    /// "42%" in `locale`, no fraction digits.
    public static func formatPercent(_ ratio: Double, locale: Locale) -> String {
        ratio.formatted(.percent.precision(.fractionLength(0)).locale(locale))
    }

    /// "128K" in `locale`: compact notation with at most one fraction digit.
    public static func formatTokens(_ value: Int, locale: Locale) -> String {
        value.formatted(.number.notation(.compactName).precision(.fractionLength(0...1)).locale(locale))
    }
}

extension EnvironmentValues {
    @Entry var aedstAiContext: AedstAiContextValue = AedstAiContextValue(usedTokens: 0, maxTokens: 0)
}

/// How much of the model's context window the conversation has used, matching shadcn AI Elements `Context`:
/// a small outline button showing the percentage (`AedstAiContextTrigger`) that opens a card with the
/// header and progress bar (`AedstAiContextContentHeader`), the breakdown (`AedstAiContextContentBody` with the
/// usage rows) and a footer. Numbers use FormatStyle in the current locale (compact for tokens).
/// Adaptation: the card is a popover opened by activating the button, so it works by touch, keyboard and
/// VoiceOver alike (web opens it on hover and focus).
public struct AedstAiContext<Content: View>: View {
    private let value: AedstAiContextValue
    private let label: String
    private let content: Content
    @State private var isPresented = false

    /// - Parameters:
    ///   - usedTokens: Tokens used so far.
    ///   - maxTokens: The model's context window; set it per model (the API rarely sends it).
    ///   - usage: Optional breakdown.
    ///   - label: Accessible name read before the percentage, e.g. "Context used".
    ///   - content: The card, usually `AedstAiContextContent`.
    public init(
        usedTokens: Int,
        maxTokens: Int,
        usage: AedstAiContextUsage? = nil,
        label: String,
        @ViewBuilder content: () -> Content
    ) {
        self.value = AedstAiContextValue(usedTokens: usedTokens, maxTokens: maxTokens, usage: usage)
        self.label = label
        self.content = content()
    }

    public var body: some View {
        AedstAiContextTrigger(label: label) { isPresented = true }
            .aedstPopover(isPresented: $isPresented, arrowEdge: .bottom) {
                content.environment(\.aedstAiContext, value)
            }
            .environment(\.aedstAiContext, value)
    }
}

/// The small outline button with the percentage used (`AiContextTrigger`).
public struct AedstAiContextTrigger: View {
    private let label: String
    private let action: () -> Void
    @Environment(\.aedstAiContext) private var value
    @Environment(\.locale) private var locale

    public init(label: String, action: @escaping () -> Void) {
        self.label = label
        self.action = action
    }

    public var body: some View {
        let percent = AedstAiContextValue.formatPercent(value.ratio, locale: locale)
        AedstButton(percent, variant: .outline, size: .sm, fillsWidth: false, action: action)
            .monospacedDigit()
            .accessibilityLabel(Text(label))
            .accessibilityValue(Text(percent))
    }
}

/// The card's column (`AiContextContent`): 256 pt wide, sections divided by lines.
public struct AedstAiContextContent<Content: View>: View {
    private let content: Content

    public init(@ViewBuilder content: () -> Content) {
        self.content = content()
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: AedstSpacing.none) {
            content
        }
        .frame(width: 256)
    }
}

/// Heading, used / max tokens and the progress bar (`AiContextContentHeader`).
public struct AedstAiContextContentHeader: View {
    private let label: String
    @Environment(\.aedstAiContext) private var value
    @Environment(\.locale) private var locale

    /// - Parameter label: Heading and the progress bar's accessible name, e.g. "Context".
    public init(label: String) {
        self.label = label
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: AedstSpacing.sm) {
            HStack(spacing: AedstSpacing.md) {
                Text(label)
                    .font(AedstTypography.body.weight(.medium))
                    .accessibilityAddTraits(.isHeader)
                Spacer(minLength: AedstSpacing.none)
                Text(verbatim: "\(AedstAiContextValue.formatTokens(value.usedTokens, locale: locale)) / \(AedstAiContextValue.formatTokens(value.maxTokens, locale: locale))")
                    .font(AedstTypography.body)
                    .foregroundStyle(AedstColor.mutedForeground)
                    .monospacedDigit()
            }
            AedstProgressView(value: value.ratio)
                .accessibilityLabel(Text(label))
        }
        .padding(AedstSpacing.md)
    }
}

/// The breakdown section (`AiContextContentBody`); put usage rows in it.
public struct AedstAiContextContentBody<Content: View>: View {
    private let content: Content

    public init(@ViewBuilder content: () -> Content) {
        self.content = content()
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: AedstSpacing.xs) {
            Divider()
            content
        }
        .font(AedstTypography.body)
        .padding([.horizontal, .bottom], AedstSpacing.md)
    }
}

/// The muted footer (`AiContextContentFooter`), e.g. the cost.
public struct AedstAiContextContentFooter<Content: View>: View {
    private let content: Content

    public init(@ViewBuilder content: () -> Content) {
        self.content = content()
    }

    public var body: some View {
        HStack(spacing: AedstSpacing.md) {
            content
        }
        .font(AedstTypography.caption)
        .foregroundStyle(AedstColor.secondaryForeground)
        .padding(AedstSpacing.md)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(AedstColor.secondary)
    }
}

/// Which count a usage row shows (web `AiContextInputUsage`, `OutputUsage`, `ReasoningUsage`, `CacheUsage`).
public enum AedstAiContextUsageKind: Sendable, CaseIterable {
    case input
    case output
    case reasoning
    case cache

    func tokens(in usage: AedstAiContextUsage?) -> Int? {
        switch self {
        case .input: usage?.inputTokens
        case .output: usage?.outputTokens
        case .reasoning: usage?.reasoningTokens
        case .cache: usage?.cachedInputTokens
        }
    }
}

/// One breakdown row: a muted label and the compact count; renders nothing when `usage` lacks the count.
public struct AedstAiContextUsageRow: View {
    private let kind: AedstAiContextUsageKind
    private let label: String
    @Environment(\.aedstAiContext) private var value
    @Environment(\.locale) private var locale

    public init(_ kind: AedstAiContextUsageKind, label: String) {
        self.kind = kind
        self.label = label
    }

    public var body: some View {
        if let tokens = kind.tokens(in: value.usage) {
            HStack(spacing: AedstSpacing.md) {
                Text(label).foregroundStyle(AedstColor.mutedForeground)
                Spacer(minLength: AedstSpacing.none)
                Text(AedstAiContextValue.formatTokens(tokens, locale: locale)).monospacedDigit()
            }
            .accessibilityElement(children: .combine)
        }
    }
}

#Preview("AedstAiContext") {
    AedstAiContext(
        usedTokens: 48_200,
        maxTokens: 200_000,
        usage: AedstAiContextUsage(inputTokens: 40_000, outputTokens: 8_200),
        label: "Context used"
    ) {
        AedstAiContextContent {
            AedstAiContextContentHeader(label: "Context")
            AedstAiContextContentBody {
                AedstAiContextUsageRow(.input, label: "Input")
                AedstAiContextUsageRow(.output, label: "Output")
                AedstAiContextUsageRow(.reasoning, label: "Reasoning")
            }
            AedstAiContextContentFooter {
                Text(verbatim: "$0.12")
            }
        }
    }
    .padding()
}

#endif
