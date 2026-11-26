import Foundation
import SwiftUI

// iOS, macOS and visionOS only: tvOS and watchOS are scaffolded package platforms without app targets.
#if os(iOS) || os(macOS) || os(visionOS)

/// Lifecycle of a tool call (the AI SDK tool-part states, as on web).
public enum AedstAiToolState: String, Sendable, CaseIterable {
    case inputStreaming
    case inputAvailable
    case approvalRequested
    case approvalResponded
    case outputAvailable
    case outputError
    case outputDenied

    /// Line status: running, pending (awaiting approval), success, error, skipped (denied).
    public var status: AedstTraceStatus {
        switch self {
        case .inputStreaming, .inputAvailable, .approvalResponded: .running
        case .approvalRequested: .pending
        case .outputAvailable: .success
        case .outputError: .error
        case .outputDenied: .skipped
        }
    }
}

/// Pure helpers of `AedstAiTool`, unit-tested.
public enum AedstAiToolFormatting {
    /// Tool arguments or results as indented JSON with sorted keys (web `JSON.stringify(value, null, 2)`);
    /// `nil` when the value cannot be encoded.
    public static func json<Value: Encodable>(_ value: Value) -> String? {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys, .withoutEscapingSlashes]
        guard let data = try? encoder.encode(value) else { return nil }
        return String(data: data, encoding: .utf8)
    }
}

/// One tool call as a collapsible line with its input and output, matching the web `AiTool`. The panel holds
/// `AedstAiToolInput` and `AedstAiToolOutput`; the `approvalRequested` state is `AedstAiToolApproval` instead.
public struct AedstAiTool<Content: View>: View {
    private let title: String
    private let state: AedstAiToolState
    private let systemImage: String
    private let initiallyExpanded: Bool
    private let content: Content

    /// - Parameters:
    ///   - title: Tensed by the caller: "Running ls", "Ran ls", "Failed to run ls", "Denied ls".
    public init(
        _ title: String,
        state: AedstAiToolState,
        systemImage: String = "wrench.adjustable",
        initiallyExpanded: Bool = false,
        @ViewBuilder content: () -> Content
    ) {
        self.title = title
        self.state = state
        self.systemImage = systemImage
        self.initiallyExpanded = initiallyExpanded
        self.content = content()
    }

    public var body: some View {
        AedstAiChainOfThought(initiallyExpanded: initiallyExpanded) {
            AedstAiToolHeader(title, state: state, systemImage: systemImage)
        } content: {
            content
        }
    }
}

/// The tool line; the leading icon follows the state (spinner while running, a cross on error).
public struct AedstAiToolHeader: View {
    private let title: String
    private let state: AedstAiToolState
    private let systemImage: String
    private let statusLabels: AedstTraceStatusLabels

    public init(
        _ title: String,
        state: AedstAiToolState,
        systemImage: String = "wrench.adjustable",
        statusLabels: AedstTraceStatusLabels = .localized
    ) {
        self.title = title
        self.state = state
        self.systemImage = systemImage
        self.statusLabels = statusLabels
    }

    public var body: some View {
        AedstAiChainOfThoughtHeader(
            title, systemImage: systemImage, status: state.status, statusLabel: statusLabels.label(for: state.status)
        )
    }
}

/// A labelled group ("Parameters", "Result") of the tool panel.
private struct AedstAiToolSection<Content: View>: View {
    let label: String
    @ViewBuilder let content: Content

    var body: some View {
        VStack(alignment: .leading, spacing: AedstSpacing.xs) {
            Text(label)
                .font(AedstTypography.caption.weight(.medium))
                .foregroundStyle(AedstColor.mutedForeground)
                .accessibilityAddTraits(.isHeader)
            content
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text(label))
    }
}

/// Tool arguments as JSON code (format objects with `AedstAiToolFormatting.json`).
public struct AedstAiToolInput: View {
    private let label: String
    private let input: String
    private let showsCopyButton: Bool

    public init(label: String, input: String, showsCopyButton: Bool = true) {
        self.label = label
        self.input = input
        self.showsCopyButton = showsCopyButton
    }

    public var body: some View {
        AedstAiToolSection(label: label) {
            AedstCodeBlock(input, language: "JSON", showsCopyButton: showsCopyButton)
                .frame(maxHeight: AedstAiToolLayout.maxCodeHeight)
        }
    }
}

/// The result, or the error instead of it; nothing when both are missing.
public struct AedstAiToolOutput: View {
    private let label: String
    private let output: String?
    private let errorText: String?
    private let showsCopyButton: Bool

    public init(label: String, output: String? = nil, errorText: String? = nil, showsCopyButton: Bool = true) {
        self.label = label
        self.output = output
        self.errorText = errorText
        self.showsCopyButton = showsCopyButton
    }

    public var body: some View {
        if let errorText {
            AedstAiToolSection(label: label) {
                AedstAlert(errorText, variant: .destructive)
                    .environment(\.layoutDirection, .leftToRight)
            }
        } else if let output {
            AedstAiToolSection(label: label) {
                AedstCodeBlock(output, wrapsByDefault: true, showsCopyButton: showsCopyButton, highlightsSyntax: false)
                    .frame(maxHeight: AedstAiToolLayout.maxCodeHeight)
            }
        }
    }
}

enum AedstAiToolLayout {
    /// Code in a tool panel stays at most this high (web `max-h-64`, 16 rem).
    static let maxCodeHeight: CGFloat = AedstSpacing.giant * 4
}

/// The `approvalRequested` state: not a line but an outlined item with Deny and Approve.
public struct AedstAiToolApproval: View {
    private let title: String
    private let description: String?
    private let approveLabel: String
    private let denyLabel: String
    private let systemImage: String
    private let onApprove: () -> Void
    private let onDeny: () -> Void

    /// - Parameter title: The question, e.g. "Run ls -la?".
    public init(
        _ title: String,
        description: String? = nil,
        approveLabel: String,
        denyLabel: String,
        systemImage: String = "wrench.adjustable",
        onApprove: @escaping () -> Void,
        onDeny: @escaping () -> Void
    ) {
        self.title = title
        self.description = description
        self.approveLabel = approveLabel
        self.denyLabel = denyLabel
        self.systemImage = systemImage
        self.onApprove = onApprove
        self.onDeny = onDeny
    }

    public var body: some View {
        AedstItem(title, description: description, variant: .outline, size: .sm) {
            AedstItemMedia(variant: .icon) { Image(systemName: systemImage) }
        } actions: {
            HStack(spacing: AedstSpacing.sm) {
                AedstButton(denyLabel, variant: .outline, size: .sm, fillsWidth: false, action: onDeny)
                AedstButton(approveLabel, size: .sm, fillsWidth: false, action: onApprove)
            }
        }
    }
}

#Preview("AedstAiTool") {
    VStack(alignment: .leading, spacing: AedstSpacing.md) {
        AedstAiTool("Ran ls", state: .outputAvailable, initiallyExpanded: true) {
            AedstAiToolInput(label: "Parameters", input: "{\n  \"path\" : \"src\"\n}")
            AedstAiToolOutput(label: "Result", output: "button.tsx\ncard.tsx")
        }
        AedstAiTool("Failed to run cat", state: .outputError) {
            AedstAiToolOutput(label: "Result", errorText: "ENOENT: no such file")
        }
        AedstAiToolApproval("Run rm -rf build?", approveLabel: "Approve", denyLabel: "Deny", onApprove: {}, onDeny: {})
    }
    .padding()
}

#endif
