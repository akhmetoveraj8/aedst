import SwiftUI

// iOS, macOS and visionOS only: tvOS and watchOS are scaffolded package platforms without app targets.
#if os(iOS) || os(macOS) || os(visionOS)

/// Todo state (the agent's `writeTodos` vocabulary, as on web).
public enum AedstAiQueueItemStatus: String, Sendable, CaseIterable {
    case pending
    case inProgress
    case completed

    /// Line status: pending, running (in progress), success (completed).
    public var status: AedstTraceStatus {
        switch self {
        case .pending: .pending
        case .inProgress: .running
        case .completed: .success
        }
    }
}

/// The agent's todo list, matching the web `AiQueue`: `AedstAiQueueSection`s such as "To do" and "Completed".
public struct AedstAiQueue<Content: View>: View {
    private let content: Content

    public init(@ViewBuilder content: () -> Content) {
        self.content = content()
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: AedstSpacing.xs) {
            content
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

/// A collapsible group of todos, open by default; its content is the section's `AedstAiQueueItem`s.
public struct AedstAiQueueSection<Content: View>: View {
    private let label: String
    private let systemImage: String
    private let initiallyExpanded: Bool
    private let content: Content

    /// - Parameter label: "2 to do", "Completed" (the caller pluralises).
    public init(
        _ label: String,
        systemImage: String = "checklist",
        initiallyExpanded: Bool = true,
        @ViewBuilder content: () -> Content
    ) {
        self.label = label
        self.systemImage = systemImage
        self.initiallyExpanded = initiallyExpanded
        self.content = content()
    }

    public var body: some View {
        AedstAiChainOfThought(initiallyExpanded: initiallyExpanded) {
            AedstAiQueueSectionTrigger(label, systemImage: systemImage)
        } content: {
            AedstAiQueueList { content }
        }
    }
}

/// The section line.
public struct AedstAiQueueSectionTrigger: View {
    private let label: String
    private let systemImage: String

    public init(_ label: String, systemImage: String = "checklist") {
        self.label = label
        self.systemImage = systemImage
    }

    public var body: some View {
        AedstAiChainOfThoughtHeader(label, systemImage: systemImage)
    }
}

/// The todo list of a section.
public typealias AedstAiQueueList<Content: View> = AedstAiChainOfThoughtSteps<Content>

/// One todo: an icon per state, completed ones struck through, with actions beside it. On macOS the actions
/// appear on hover or keyboard focus (always when VoiceOver runs); on touch platforms they are always shown.
public struct AedstAiQueueItem<Actions: View>: View {
    private let label: String
    private let description: String?
    private let status: AedstAiQueueItemStatus
    private let statusLabel: String?
    private let actions: Actions
    @State private var isHovered = false
    @State private var isPinnedOpen = false
    @FocusState private var actionsFocused: Bool
    @FocusState private var rowFocused: Bool
    @Environment(\.accessibilityVoiceOverEnabled) private var voiceOverEnabled

    public init(
        _ label: String,
        description: String? = nil,
        status: AedstAiQueueItemStatus = .pending,
        statusLabel: String? = nil,
        @ViewBuilder actions: () -> Actions
    ) {
        self.label = label
        self.description = description
        self.status = status
        self.statusLabel = statusLabel
        self.actions = actions()
    }

    public var body: some View {
        HStack(spacing: AedstSpacing.xs) {
            AedstAiChainOfThoughtStep(
                label, description: description, status: status.status, statusLabel: statusLabel,
                strikesThrough: status == .completed
            )
            AedstAiQueueItemActions { actions }
                .focused($actionsFocused)
                .opacity(showsActions ? 1 : 0)
        }
        .background(
            isHovered ? AedstColor.muted : Color.clear,
            in: RoundedRectangle(cornerRadius: AedstRadius.md, style: .continuous)
        )
        .onHover { isHovered = $0 }
        // Equivalents of hover: the row takes keyboard focus (Tab), a long press pins the actions open, and
        // VoiceOver / Switch Control get a "Show actions" action.
        .focusable()
        .focused($rowFocused)
        .simultaneousGesture(LongPressGesture(minimumDuration: 0.5).onEnded { _ in isPinnedOpen.toggle() })
        .accessibilityAction(named: Text(AedstStrings.showActions)) { isPinnedOpen.toggle() }
    }

    private var showsActions: Bool {
        AedstAiQueueLogic.showsActions(
            precisePointer: AedstAiQueueLogic.precisePointer, isHovered: isHovered, isFocused: actionsFocused || rowFocused,
            voiceOverEnabled: voiceOverEnabled, isPinnedOpen: isPinnedOpen
        )
    }
}

extension AedstAiQueueItem where Actions == EmptyView {
    /// A todo without actions.
    public init(_ label: String, description: String? = nil, status: AedstAiQueueItemStatus = .pending, statusLabel: String? = nil) {
        self.init(label, description: description, status: status, statusLabel: statusLabel) { EmptyView() }
    }
}

/// Pure rules of the queue, unit-tested.
enum AedstAiQueueLogic {
    /// macOS has a precise pointer (web `pointer-fine`); touch platforms do not.
    static var precisePointer: Bool {
        #if os(macOS)
        true
        #else
        false
        #endif
    }

    /// Actions hide only on a precise pointer, and show there on hover, focus, a long press (pinned open) or
    /// while VoiceOver runs.
    static func showsActions(
        precisePointer: Bool, isHovered: Bool, isFocused: Bool, voiceOverEnabled: Bool, isPinnedOpen: Bool = false
    ) -> Bool {
        !precisePointer || isHovered || isFocused || voiceOverEnabled || isPinnedOpen
    }
}

/// The buttons of one todo.
public struct AedstAiQueueItemActions<Content: View>: View {
    private let content: Content

    public init(@ViewBuilder content: () -> Content) {
        self.content = content()
    }

    public var body: some View {
        HStack(spacing: AedstSpacing.xs) { content }
            .fixedSize()
    }
}

/// An icon-only todo action; `label` is its accessible name.
public struct AedstAiQueueItemAction: View {
    private let label: String
    private let systemImage: String
    private let action: () -> Void

    public init(label: String, systemImage: String, action: @escaping () -> Void) {
        self.label = label
        self.systemImage = systemImage
        self.action = action
    }

    public var body: some View {
        AedstIconButton(systemImage: systemImage, accessibilityLabel: label, variant: .ghost, size: .iconSm, action: action)
    }
}

#Preview("AedstAiQueue") {
    AedstAiQueue {
        AedstAiQueueSection("2 to do") {
            AedstAiQueueItem("Rename the button", status: .inProgress, statusLabel: "In progress")
            AedstAiQueueItem("Update the stories", status: .pending) {
                AedstAiQueueItemAction(label: "Remove todo", systemImage: "trash") {}
            }
        }
        AedstAiQueueSection("Completed") {
            AedstAiQueueItem("Read the component", status: .completed, statusLabel: "Completed")
        }
    }
    .padding()
}

#endif
