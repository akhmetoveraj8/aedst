import SwiftUI

// iOS, macOS and visionOS only: tvOS and watchOS are scaffolded package platforms without app targets.
#if os(iOS) || os(macOS) || os(visionOS)

/// One unit of agent work whose steps appear as the agent takes them (no pending steps), matching the web
/// `AiTask`. Several tasks can be stacked; keep the running one open (open by default). The content is the
/// task's `AedstAiTaskItem`s, laid out as a step list.
public struct AedstAiTask<Content: View>: View {
    private let title: String
    private let status: AedstTraceStatus?
    private let statusLabel: String?
    private let description: String?
    private let systemImage: String?
    private let initiallyExpanded: Bool
    private let content: Content

    /// - Parameters:
    ///   - title: Present tense while running ("Searching..."), past tense when done ("Found...").
    ///   - status: `running` while the agent works, `error` on failure, `nil` when done.
    ///   - statusLabel: The status in words for VoiceOver.
    public init(
        _ title: String,
        status: AedstTraceStatus? = nil,
        statusLabel: String? = nil,
        description: String? = nil,
        systemImage: String? = nil,
        initiallyExpanded: Bool = true,
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
            AedstAiTaskTrigger(
                title, status: status, statusLabel: statusLabel, description: description, systemImage: systemImage
            )
        } content: {
            AedstAiChainOfThoughtSteps { content }
        }
    }
}

/// The task title line.
public struct AedstAiTaskTrigger: View {
    private let title: String
    private let status: AedstTraceStatus?
    private let statusLabel: String?
    private let description: String?
    private let systemImage: String?

    public init(
        _ title: String,
        status: AedstTraceStatus? = nil,
        statusLabel: String? = nil,
        description: String? = nil,
        systemImage: String? = nil
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

/// One step the agent took: `status` running, error, or success (the default) when done.
public typealias AedstAiTaskItem<Extra: View> = AedstAiChainOfThoughtStep<Extra>

/// File chip inside a step: monospaced, truncated, always left-to-right (paths).
public struct AedstAiTaskItemFile: View {
    private let name: String
    private let systemImage: String

    public init(_ name: String, systemImage: String = "doc") {
        self.name = name
        self.systemImage = systemImage
    }

    public var body: some View {
        HStack(spacing: AedstSpacing.xs) {
            Image(systemName: systemImage)
                .imageScale(.small)
                .accessibilityHidden(true)
            Text(name)
                .lineLimit(1)
                .truncationMode(.middle)
        }
        .font(AedstTypography.caption.monospaced())
        .foregroundStyle(AedstColor.secondaryForeground)
        .padding(.horizontal, AedstSpacing.xs + AedstSpacing.xxs)
        .padding(.vertical, AedstSpacing.xxs)
        .background(AedstColor.secondary, in: RoundedRectangle(cornerRadius: AedstRadius.md, style: .continuous))
        .overlay {
            RoundedRectangle(cornerRadius: AedstRadius.md, style: .continuous)
                .strokeBorder(AedstColor.border, lineWidth: 1)
        }
        .environment(\.layoutDirection, .leftToRight)
        .accessibilityElement(children: .combine)
    }
}

#Preview("AedstAiTask") {
    VStack(alignment: .leading, spacing: AedstSpacing.sm) {
        AedstAiTask("Found 3 files", description: "1.2 s") {
            AedstAiTaskItem("Searched for the button component")
            AedstAiTaskItem("Read the files") {
                HStack(spacing: AedstSpacing.xs) {
                    AedstAiTaskItemFile("ui/button.tsx")
                    AedstAiTaskItemFile("ui/button.stories.tsx")
                }
            }
        }
        AedstAiTask("Editing files", status: .running, statusLabel: "Running") {
            AedstAiTaskItem("Updating imports", status: .running, statusLabel: "Running")
        }
    }
    .padding()
}

#endif
