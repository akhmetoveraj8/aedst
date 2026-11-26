import SwiftUI

// iOS, macOS and visionOS only: tvOS and watchOS are scaffolded package platforms without app targets.
#if os(iOS) || os(macOS) || os(visionOS)

/// A delegated agent run, matching the web `AiSubagent`: a line that opens into its task
/// (`AedstAiSubagentTask`), model and tools (`AedstAiSubagentMeta` with `AedstAiSubagentModel` and
/// `AedstAiSubagentTools`) and its own tool calls (`AedstAiSubagentSteps` of `AedstAiSubagentStep`).
public struct AedstAiSubagent<Content: View>: View {
    private let title: String
    private let status: AedstTraceStatus?
    private let statusLabel: String?
    private let description: String?
    private let systemImage: String
    private let initiallyExpanded: Bool
    private let content: Content

    /// - Parameters:
    ///   - title: "Running the research agent" while it works, "Ran the research agent" when done.
    ///   - status: `running` while the subagent works, `error` on failure, `nil` when done.
    ///   - description: The duration, already formatted.
    public init(
        _ title: String,
        status: AedstTraceStatus? = nil,
        statusLabel: String? = nil,
        description: String? = nil,
        systemImage: String = "cpu",
        initiallyExpanded: Bool = false,
        @ViewBuilder content: () -> Content
    ) {
        self.title = title
        self.status = status
        self.statusLabel = statusLabel
        self.description = description
        self.systemImage = systemImage
        self.initiallyExpanded = initiallyExpanded
        self.content = content()
    }

    public var body: some View {
        AedstAiChainOfThought(initiallyExpanded: initiallyExpanded) {
            AedstAiSubagentTrigger(
                title, status: status, statusLabel: statusLabel, description: description, systemImage: systemImage
            )
        } content: {
            content
        }
    }
}

/// The subagent line.
public struct AedstAiSubagentTrigger: View {
    private let title: String
    private let status: AedstTraceStatus?
    private let statusLabel: String?
    private let description: String?
    private let systemImage: String

    public init(
        _ title: String,
        status: AedstTraceStatus? = nil,
        statusLabel: String? = nil,
        description: String? = nil,
        systemImage: String = "cpu"
    ) {
        self.title = title
        self.status = status
        self.statusLabel = statusLabel
        self.description = description
        self.systemImage = systemImage
    }

    public var body: some View {
        AedstAiChainOfThoughtHeader(
            title, systemImage: systemImage, status: status, statusLabel: statusLabel, description: description
        )
    }
}

/// The instruction the parent agent gave.
public struct AedstAiSubagentTask: View {
    private let text: String

    public init(_ text: String) {
        self.text = text
    }

    public var body: some View {
        Text(text)
            .font(AedstTypography.body)
            .foregroundStyle(AedstColor.foreground)
            .multilineTextAlignment(.leading)
            .padding(.horizontal, AedstSpacing.sm)
    }
}

/// Model and tools as labelled badge rows (the web description list), aligned in two columns.
public struct AedstAiSubagentMeta<Content: View>: View {
    private let content: Content

    public init(@ViewBuilder content: () -> Content) {
        self.content = content()
    }

    public var body: some View {
        Grid(alignment: .leadingFirstTextBaseline, horizontalSpacing: AedstSpacing.md, verticalSpacing: AedstSpacing.xs) {
            content
        }
        .padding(.horizontal, AedstSpacing.sm)
    }
}

/// One term and its badges. Modifiers on a `GridRow` would turn it into a full-width cell, so the term and the
/// value stay two elements, read in order ("Model", "gpt-5").
private struct AedstAiSubagentMetaRow<Value: View>: View {
    let label: String
    @ViewBuilder let value: Value

    var body: some View {
        GridRow {
            Text(label)
                .font(AedstTypography.caption)
                .foregroundStyle(AedstColor.mutedForeground)
                .gridColumnAlignment(.leading)
            value
        }
    }
}

/// The model row; the id stays left-to-right.
public struct AedstAiSubagentModel: View {
    private let label: String
    private let model: String

    /// - Parameters:
    ///   - label: Visible term, e.g. "Model".
    ///   - model: Model id.
    public init(label: String, model: String) {
        self.label = label
        self.model = model
    }

    public var body: some View {
        AedstAiSubagentMetaRow(label: label) {
            AedstBadge(model, variant: .outline)
                .environment(\.layoutDirection, .leftToRight)
        }
    }
}

/// The tools row: one wrapping badge per tool name (left-to-right).
public struct AedstAiSubagentTools: View {
    private let label: String
    private let tools: [String]

    /// - Parameter label: Visible term, e.g. "Tools".
    public init(label: String, tools: [String]) {
        self.label = label
        self.tools = tools
    }

    public var body: some View {
        AedstAiSubagentMetaRow(label: label) {
            AedstAiFlowLayout {
                ForEach(tools, id: \.self) { tool in
                    AedstBadge(tool, variant: .secondary)
                        .environment(\.layoutDirection, .leftToRight)
                }
            }
        }
    }
}

/// The subagent's tool calls.
public typealias AedstAiSubagentSteps<Content: View> = AedstAiChainOfThoughtSteps<Content>

/// One tool call the subagent made.
public typealias AedstAiSubagentStep<Extra: View> = AedstAiChainOfThoughtStep<Extra>

#Preview("AedstAiSubagent") {
    AedstAiSubagent("Ran the research agent", description: "12 s", initiallyExpanded: true) {
        AedstAiSubagentTask("Find every use of the old button API.")
        AedstAiSubagentMeta {
            AedstAiSubagentModel(label: "Model", model: "gpt-5-mini")
            AedstAiSubagentTools(label: "Tools", tools: ["grep", "read_file", "list_dir"])
        }
        AedstAiSubagentSteps {
            AedstAiSubagentStep("grep \"Button\"", description: "14 matches")
            AedstAiSubagentStep("Read 3 files")
        }
    }
    .padding()
}

#endif
