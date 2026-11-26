import SwiftUI

// iOS, macOS and visionOS only: tvOS and watchOS are scaffolded package platforms without app targets.
#if os(iOS) || os(macOS) || os(visionOS)

/// Every step of the agent's plan, known up front (pending ones included), matching the web `AiPlan`. Use
/// `AedstAiTask` when the steps appear as the agent takes them. Open by default; the title line spins while the
/// plan is still being written. `actions` sit beside the title line (`AiPlanAction`), never inside the disclosure.
///
/// The panel holds `AedstAiPlanDescription`, `AedstAiPlanSteps` with `AedstAiPlanStep`s and `AedstAiPlanFooter`.
public struct AedstAiPlan<Actions: View, Content: View>: View {
    private let title: String
    private let description: String?
    private let isStreaming: Bool
    private let systemImage: String
    private let initiallyExpanded: Bool
    private let actions: Actions
    private let content: Content

    /// - Parameters:
    ///   - title: Already localized plan title.
    ///   - description: Progress after the title, e.g. "2 of 5 done".
    ///   - isStreaming: The plan is still being written: the title line shows a spinner.
    public init(
        _ title: String,
        description: String? = nil,
        isStreaming: Bool = false,
        systemImage: String = "point.topleft.down.curvedto.point.bottomright.up",
        initiallyExpanded: Bool = true,
        @ViewBuilder actions: () -> Actions,
        @ViewBuilder content: () -> Content
    ) {
        self.title = title
        self.description = description
        self.isStreaming = isStreaming
        self.systemImage = systemImage
        self.initiallyExpanded = initiallyExpanded
        self.actions = actions()
        self.content = content()
    }

    public var body: some View {
        AedstAiChainOfThought(initiallyExpanded: initiallyExpanded) {
            AedstAiPlanTrigger(title, description: description, isStreaming: isStreaming, systemImage: systemImage)
        } actions: {
            AedstAiPlanAction { actions }
        } content: {
            content
        }
    }
}

extension AedstAiPlan where Actions == EmptyView {
    /// A plan without header actions.
    public init(
        _ title: String,
        description: String? = nil,
        isStreaming: Bool = false,
        systemImage: String = "point.topleft.down.curvedto.point.bottomright.up",
        initiallyExpanded: Bool = true,
        @ViewBuilder content: () -> Content
    ) {
        self.init(
            title, description: description, isStreaming: isStreaming, systemImage: systemImage,
            initiallyExpanded: initiallyExpanded, actions: { EmptyView() }, content: content
        )
    }
}

/// The plan title line; spins while streaming.
public struct AedstAiPlanTrigger: View {
    private let title: String
    private let description: String?
    private let isStreaming: Bool
    private let systemImage: String

    public init(
        _ title: String,
        description: String? = nil,
        isStreaming: Bool = false,
        systemImage: String = "point.topleft.down.curvedto.point.bottomright.up"
    ) {
        self.title = title
        self.description = description
        self.isStreaming = isStreaming
        self.systemImage = systemImage
    }

    public var body: some View {
        AedstAiChainOfThoughtHeader(
            title, systemImage: systemImage, status: isStreaming ? .running : nil, description: description
        )
    }
}

/// Buttons beside the plan title line.
public struct AedstAiPlanAction<Content: View>: View {
    private let content: Content

    public init(@ViewBuilder content: () -> Content) {
        self.content = content()
    }

    public var body: some View {
        HStack(spacing: AedstSpacing.xs) { content }
            .fixedSize()
    }
}

/// Summary above the steps.
public struct AedstAiPlanDescription: View {
    private let text: String

    public init(_ text: String) {
        self.text = text
    }

    public var body: some View {
        Text(text)
            .font(AedstTypography.body)
            .foregroundStyle(AedstColor.mutedForeground)
            .multilineTextAlignment(.leading)
            .padding(.horizontal, AedstSpacing.sm)
    }
}

/// The plan's step list.
public typealias AedstAiPlanSteps<Content: View> = AedstAiChainOfThoughtSteps<Content>

/// One step: `status` pending, running (current), success (done), error or skipped.
public typealias AedstAiPlanStep<Extra: View> = AedstAiChainOfThoughtStep<Extra>

/// Row under the steps (a "Build it" button, a note).
public struct AedstAiPlanFooter<Content: View>: View {
    private let content: Content

    public init(@ViewBuilder content: () -> Content) {
        self.content = content()
    }

    public var body: some View {
        HStack(spacing: AedstSpacing.sm) { content }
            .padding(.horizontal, AedstSpacing.sm)
            .padding(.top, AedstSpacing.xs)
    }
}

#Preview("AedstAiPlan") {
    AedstAiPlan("Rename the button component", description: "2 of 4 done", isStreaming: true) {
        AedstIconButton(systemImage: "doc.on.doc", accessibilityLabel: "Copy plan", size: .iconSm) {}
    } content: {
        AedstAiPlanDescription("Move the files, update the imports, then run the tests.")
        AedstAiPlanSteps {
            AedstAiPlanStep("Move the files")
            AedstAiPlanStep("Update the imports")
            AedstAiPlanStep("Run the tests", status: .running, statusLabel: "Running")
            AedstAiPlanStep("Open a pull request", status: .pending, statusLabel: "Pending")
        }
        AedstAiPlanFooter {
            AedstButton("Build it", size: .sm, fillsWidth: false) {}
        }
    }
    .padding()
}

#endif
