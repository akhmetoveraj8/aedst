import SwiftUI

// iOS, macOS and visionOS only: tvOS and watchOS are scaffolded package platforms without app targets.
#if os(iOS) || os(macOS) || os(visionOS)

/// A tool call's approval lifecycle (web `AiConfirmationState`), without depending on an AI SDK.
public enum AedstAiConfirmationState: Sendable, CaseIterable {
    case approvalRequested
    case approvalResponded
    case outputDenied
    case outputAvailable
}

/// The approval attached to a tool call (web `AiConfirmationApproval`).
public struct AedstAiConfirmationApproval: Hashable, Sendable {
    public let id: String
    /// `nil` until the person answers.
    public let approved: Bool?
    public let reason: String?

    public init(id: String, approved: Bool? = nil, reason: String? = nil) {
        self.id = id
        self.approved = approved
        self.reason = reason
    }
}

/// Which parts of a confirmation show: `pending` shows `AedstAiConfirmationRequest` and the actions,
/// `accepted` shows `AedstAiConfirmationAccepted`, `rejected` shows `AedstAiConfirmationRejected`.
public enum AedstAiConfirmationPhase: Sendable, Equatable {
    case pending
    case accepted
    case rejected
    /// Answered, but the answer is not known (yet).
    case answered

    public init(state: AedstAiConfirmationState, approval: AedstAiConfirmationApproval) {
        if state == .approvalRequested {
            self = .pending
        } else if state == .outputDenied || approval.approved == false {
            self = .rejected
        } else if approval.approved == true {
            self = .accepted
        } else {
            self = .answered
        }
    }
}

extension EnvironmentValues {
    @Entry var aedstAiConfirmationPhase: AedstAiConfirmationPhase = .pending
}

/// Asks the person for a yes or no before a tool runs, matching shadcn AI Elements `Confirmation`: a small outline
/// `AedstItem` with an icon (`AiConfirmationMedia`), a title and description chosen by phase, and Deny / Approve
/// buttons (`AedstAiConfirmationActions`) that disappear once answered. Nothing renders until there is an
/// approval. VoiceOver treats it as one group (web `role="group"`).
public struct AedstAiConfirmation<Media: View, Actions: View>: View {
    private let state: AedstAiConfirmationState
    private let approval: AedstAiConfirmationApproval?
    private let title: (AedstAiConfirmationPhase) -> String
    private let description: (AedstAiConfirmationPhase) -> String?
    private let media: Media
    private let actions: Actions

    /// - Parameters:
    ///   - state: Lifecycle state of the tool call.
    ///   - approval: The approval; `nil` renders nothing.
    ///   - title: Title per phase (web `AiConfirmationTitle` inside Request / Accepted / Rejected).
    ///   - description: Optional description per phase (`AiConfirmationDescription`).
    ///   - media: Icon (`AiConfirmationMedia`), e.g. `Image(systemName: "exclamationmark.shield")`.
    ///   - actions: Usually `AedstAiConfirmationActions` with two `AedstAiConfirmationAction`s; the phase parts
    ///     (`AedstAiConfirmationAccepted`, ...) may also go here, e.g. a badge.
    public init(
        state: AedstAiConfirmationState,
        approval: AedstAiConfirmationApproval?,
        title: @escaping (AedstAiConfirmationPhase) -> String,
        description: @escaping (AedstAiConfirmationPhase) -> String? = { _ in nil },
        @ViewBuilder media: () -> Media,
        @ViewBuilder actions: () -> Actions
    ) {
        self.state = state
        self.approval = approval
        self.title = title
        self.description = description
        self.media = media()
        self.actions = actions()
    }

    public var body: some View {
        if let approval {
            let phase = AedstAiConfirmationPhase(state: state, approval: approval)
            AedstItem(title(phase), description: description(phase), variant: .outline, size: .sm) {
                AedstItemMedia(variant: .icon, size: .sm) { media }
                    .accessibilityHidden(true)
            } actions: {
                actions
            }
            .environment(\.aedstAiConfirmationPhase, phase)
            .accessibilityElement(children: .contain)
        }
    }
}

/// Shows its content only while the approval is pending (`AiConfirmationRequest`).
public struct AedstAiConfirmationRequest<Content: View>: View {
    private let content: Content
    @Environment(\.aedstAiConfirmationPhase) private var phase

    public init(@ViewBuilder content: () -> Content) { self.content = content() }

    public var body: some View {
        if phase == .pending { content }
    }
}

/// Shows its content once the person approved (`AiConfirmationAccepted`).
public struct AedstAiConfirmationAccepted<Content: View>: View {
    private let content: Content
    @Environment(\.aedstAiConfirmationPhase) private var phase

    public init(@ViewBuilder content: () -> Content) { self.content = content() }

    public var body: some View {
        if phase == .accepted { content }
    }
}

/// Shows its content once the person denied, or the output was denied (`AiConfirmationRejected`).
public struct AedstAiConfirmationRejected<Content: View>: View {
    private let content: Content
    @Environment(\.aedstAiConfirmationPhase) private var phase

    public init(@ViewBuilder content: () -> Content) { self.content = content() }

    public var body: some View {
        if phase == .rejected { content }
    }
}

/// The Deny / Approve row (`AiConfirmationActions`); hidden once the approval is answered.
public struct AedstAiConfirmationActions<Content: View>: View {
    private let content: Content
    @Environment(\.aedstAiConfirmationPhase) private var phase

    public init(@ViewBuilder content: () -> Content) { self.content = content() }

    public var body: some View {
        if phase == .pending {
            HStack(spacing: AedstSpacing.sm) { content }
        }
    }
}

/// A small button for the actions row (`AiConfirmationAction`).
public struct AedstAiConfirmationAction: View {
    private let title: String
    private let variant: AedstButtonVariant
    private let action: () -> Void

    public init(_ title: String, variant: AedstButtonVariant = .default, action: @escaping () -> Void) {
        self.title = title
        self.variant = variant
        self.action = action
    }

    public var body: some View {
        AedstButton(title, variant: variant, size: .sm, fillsWidth: false, action: action)
    }
}

#Preview("AedstAiConfirmation") {
    @Previewable @State var approved: Bool?
    AedstAiConfirmation(
        state: approved == nil ? .approvalRequested : .approvalResponded,
        approval: AedstAiConfirmationApproval(id: "call-1", approved: approved),
        title: { phase in
            switch phase {
            case .pending: "Delete 3 files?"
            case .accepted: "Approved: 3 files deleted"
            case .rejected: "Denied: nothing was deleted"
            case .answered: "Answered"
            }
        },
        description: { $0 == .pending ? "The agent wants to run rm on build/." : nil }
    ) {
        Image(systemName: "exclamationmark.shield")
    } actions: {
        AedstAiConfirmationActions {
            AedstAiConfirmationAction("Deny", variant: .outline) { approved = false }
            AedstAiConfirmationAction("Approve") { approved = true }
        }
        AedstAiConfirmationAccepted { AedstBadge("Approved", variant: .success) }
        AedstAiConfirmationRejected { AedstBadge("Denied", variant: .destructive) }
    }
    .padding()
}

#endif
