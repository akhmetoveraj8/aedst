import SwiftUI

// iOS, macOS and visionOS only: tvOS and watchOS are scaffolded package platforms without app targets.
#if os(iOS) || os(macOS) || os(visionOS)

/// A point in the conversation the user can return to, matching the web `AiCheckpoint`: a separator line after a
/// turn with a label (an `AedstMarker` with a bookmark) and a Restore button (`AedstAiCheckpointTrigger`).
/// Restoring is the caller's job (keep that turn, drop every later message).
///
/// Adaptation: the marker carries the icon and label as one static text and the button sits beside it, because
/// a button inside the marker would be merged into its single accessibility element.
public struct AedstAiCheckpoint<Trigger: View>: View {
    private let label: String?
    private let systemImage: String
    private let trigger: Trigger

    /// - Parameters:
    ///   - label: Optional text before the button ("Button renamed").
    ///   - systemImage: Decorative leading icon (`AiCheckpointIcon`).
    ///   - trigger: Usually an `AedstAiCheckpointTrigger`.
    public init(_ label: String? = nil, systemImage: String = "bookmark", @ViewBuilder trigger: () -> Trigger) {
        self.label = label
        self.systemImage = systemImage
        self.trigger = trigger()
    }

    public var body: some View {
        HStack(spacing: AedstSpacing.sm) {
            rule
            AedstMarker(systemImage: systemImage) {
                if let label {
                    Text(label)
                }
            }
            .fixedSize()
            trigger
            rule
        }
        .padding(.vertical, AedstSpacing.xs)
        .accessibilityElement(children: .contain)
    }

    private var rule: some View {
        AedstSeparator()
            .frame(minWidth: AedstSpacing.lg, maxWidth: .infinity)
    }
}

/// The Restore button (outline, extra small). `accessibilityHint` names the checkpoint when the visible text alone
/// is ambiguous ("Restores the thread to Button renamed"); `tooltip` shows on hover (macOS) or a long press.
public struct AedstAiCheckpointTrigger: View {
    private let title: String
    private let tooltip: String?
    private let accessibilityHint: String?
    private let action: () -> Void

    public init(_ title: String, tooltip: String? = nil, accessibilityHint: String? = nil, action: @escaping () -> Void) {
        self.title = title
        self.tooltip = tooltip
        self.accessibilityHint = accessibilityHint
        self.action = action
    }

    public var body: some View {
        let button = AedstButton(title, variant: .outline, size: .xs, fillsWidth: false, action: action)
            .accessibilityHint(Text(AedstAiCheckpointLogic.hint(accessibilityHint: accessibilityHint, tooltip: tooltip)))
        if let tooltip {
            button.aedstTooltip(tooltip)
        } else {
            button
        }
    }
}

/// Pure rules of the checkpoint, unit-tested.
enum AedstAiCheckpointLogic {
    /// The explicit hint wins, then the tooltip (so touch and VoiceOver users get the same hint), else nothing.
    static func hint(accessibilityHint: String?, tooltip: String?) -> String {
        accessibilityHint ?? tooltip ?? ""
    }
}

#Preview("AedstAiCheckpoint") {
    VStack(spacing: AedstSpacing.lg) {
        AedstAiCheckpoint("Button renamed") {
            AedstAiCheckpointTrigger("Restore", tooltip: "Restore the thread to this point") {}
        }
        AedstAiCheckpoint {
            AedstAiCheckpointTrigger("Restore checkpoint") {}
        }
    }
    .padding()
}

#endif
