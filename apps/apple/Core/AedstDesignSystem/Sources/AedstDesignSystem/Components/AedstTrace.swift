import SwiftUI

// iOS, macOS and visionOS only: tvOS and watchOS are scaffolded package platforms without app targets.
#if os(iOS) || os(macOS) || os(visionOS)

/// Mirrors the web `Trace` component's `status` axis (`ui-kit.yaml`: pending, running, success, error, skipped).
public enum AedstTraceStatus: String, Sendable, CaseIterable {
    case pending
    case running
    case success
    case error
    case skipped

    var systemImage: String {
        switch self {
        case .pending: "circle"
        case .running: "circle.dotted"
        case .success: "checkmark.circle.fill"
        case .error: "xmark.circle.fill"
        case .skipped: "minus.circle"
        }
    }

    var tint: Color {
        switch self {
        case .pending, .skipped: AedstColor.mutedForeground
        case .running: AedstColor.info
        case .success: AedstColor.success
        case .error: AedstColor.destructive
        }
    }
}

/// One step of an execution trace (an agent action, a tool call) with optional nested steps.
public struct AedstTraceStep: Sendable, Identifiable, Equatable {
    public let id: String
    /// Already localized or verbatim title.
    public let title: String
    public let status: AedstTraceStatus
    /// Already formatted by the caller, for example "1.2 s".
    public let duration: String?
    /// Extra text (arguments, output) shown when the step is expanded.
    public let detail: String?
    public let children: [AedstTraceStep]
    /// Initial open state; `nil` opens running and failed steps.
    public let isInitiallyExpanded: Bool?

    public init(
        id: String,
        title: String,
        status: AedstTraceStatus,
        duration: String? = nil,
        detail: String? = nil,
        children: [AedstTraceStep] = [],
        isInitiallyExpanded: Bool? = nil
    ) {
        self.id = id
        self.title = title
        self.status = status
        self.duration = duration
        self.detail = detail
        self.children = children
        self.isInitiallyExpanded = isInitiallyExpanded
    }

    var isExpandable: Bool { !children.isEmpty || detail != nil }
    var opensInitially: Bool { isInitiallyExpanded ?? (status == .running || status == .error) }
}

/// One visible label per status: status is never colour alone.
public struct AedstTraceStatusLabels: Sendable, Equatable {
    public let pending: String
    public let running: String
    public let success: String
    public let error: String
    public let skipped: String

    public init(pending: String, running: String, success: String, error: String, skipped: String) {
        self.pending = pending
        self.running = running
        self.success = success
        self.error = error
        self.skipped = skipped
    }

    /// The design system's own translations (en, ru, tg, uz, ar).
    public static var localized: AedstTraceStatusLabels {
        AedstTraceStatusLabels(
            pending: AedstStrings.tracePending,
            running: AedstStrings.traceRunning,
            success: AedstStrings.traceSuccess,
            error: AedstStrings.traceError,
            skipped: AedstStrings.traceSkipped
        )
    }

    public func label(for status: AedstTraceStatus) -> String {
        switch status {
        case .pending: pending
        case .running: running
        case .success: success
        case .error: error
        case .skipped: skipped
        }
    }
}

/// Pure tree helpers of the trace, kept apart from the view so they are unit-tested.
enum AedstTraceLogic {
    /// Depth-first list of every step.
    static func flatten(_ steps: [AedstTraceStep]) -> [AedstTraceStep] {
        steps.flatMap { [$0] + flatten($0.children) }
    }

    /// Status per step id, remembered between renders.
    static func statuses(_ steps: [AedstTraceStep]) -> [String: AedstTraceStatus] {
        Dictionary(flatten(steps).map { ($0.id, $0.status) }, uniquingKeysWith: { _, last in last })
    }

    /// Text for the screen reader: only steps that existed before and whose status changed. `nil` on the first
    /// render (`previous == nil`), for new steps and when nothing changed.
    static func announcement(
        previous: [String: AedstTraceStatus]?,
        steps: [AedstTraceStep],
        labels: AedstTraceStatusLabels
    ) -> String? {
        guard let previous else { return nil }
        let changed = flatten(steps).filter { step in
            guard let before = previous[step.id] else { return false }
            return before != step.status
        }
        guard !changed.isEmpty else { return nil }
        return changed.map { "\($0.title): \(labels.label(for: $0.status))" }.joined(separator: ". ")
    }
}

/// Collapsible step tree for agent and tool execution traces, matching the web `Trace`. Every step with a
/// detail or children is a disclosure (`AedstCollapsible`); status is an icon plus a text label; status changes
/// (not the first render, not expanding) are announced to VoiceOver.
public struct AedstTrace: View {
    private let steps: [AedstTraceStep]
    private let statusLabels: AedstTraceStatusLabels
    @State private var previousStatuses: [String: AedstTraceStatus]?

    public init(steps: [AedstTraceStep], statusLabels: AedstTraceStatusLabels = .localized) {
        self.steps = steps
        self.statusLabels = statusLabels
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: AedstSpacing.none) {
            ForEach(steps) { step in
                AedstTraceItem(step: step, statusLabels: statusLabels)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .onChange(of: steps, initial: true) { _, current in
            let text = AedstTraceLogic.announcement(previous: previousStatuses, steps: current, labels: statusLabels)
            previousStatuses = AedstTraceLogic.statuses(current)
            if let text {
                AedstAnnouncer.post(text)
            }
        }
    }
}

/// One step and, recursively, its children.
private struct AedstTraceItem: View {
    let step: AedstTraceStep
    let statusLabels: AedstTraceStatusLabels

    var body: some View {
        if step.isExpandable {
            AedstCollapsible(initiallyExpanded: step.opensInitially) {
                AedstTraceRow(step: step, statusLabels: statusLabels)
            } content: {
                VStack(alignment: .leading, spacing: AedstSpacing.none) {
                    if let detail = step.detail {
                        Text(detail)
                            .font(AedstTypography.caption)
                            .foregroundStyle(AedstColor.mutedForeground)
                            .padding(.horizontal, AedstSpacing.sm)
                            .padding(.vertical, AedstSpacing.xs)
                    }
                    ForEach(step.children) { child in
                        AedstTraceItem(step: child, statusLabels: statusLabels)
                    }
                }
                // Guide line down the leading edge of the nested steps (mirrors in right-to-left layouts).
                .padding(.leading, AedstSpacing.xs)
                .overlay(alignment: .leading) {
                    AedstSeparator(.vertical)
                }
                .padding(.leading, AedstSpacing.lg)
            }
        } else {
            // Leading inset: aligns with rows that have a chevron.
            AedstTraceRow(step: step, statusLabels: statusLabels)
                .padding(.leading, AedstSpacing.xxl + AedstSpacing.sm)
                .padding(.trailing, AedstSpacing.sm)
                .frame(minHeight: AedstSpacing.xxxl)
        }
    }
}

/// Status icon, title, status label and duration of one step; read as a single element.
private struct AedstTraceRow: View {
    let step: AedstTraceStep
    let statusLabels: AedstTraceStatusLabels

    var body: some View {
        HStack(spacing: AedstSpacing.sm) {
            Group {
                if step.status == .running {
                    ProgressView()
                        .controlSize(.small)
                } else {
                    Image(systemName: step.status.systemImage)
                }
            }
            .foregroundStyle(step.status.tint)
            .accessibilityHidden(true)

            Text(step.title)
                .font(AedstTypography.body.weight(.medium))
                .foregroundStyle(AedstColor.foreground)
                .lineLimit(1)
                .frame(maxWidth: .infinity, alignment: .leading)

            Text(statusLabels.label(for: step.status))
                .font(AedstTypography.caption)
                .foregroundStyle(AedstColor.mutedForeground)

            if let duration = step.duration {
                Text(duration)
                    .font(AedstTypography.caption)
                    .monospacedDigit()
                    .foregroundStyle(AedstColor.mutedForeground)
            }
        }
        .accessibilityElement(children: .combine)
    }
}

#Preview("AedstTrace") {
    AedstTrace(steps: [
        AedstTraceStep(id: "plan", title: "Plan", status: .success, duration: "0.4 s"),
        AedstTraceStep(
            id: "search",
            title: "Search the codebase",
            status: .running,
            detail: "query: \"AedstButton\"",
            children: [
                AedstTraceStep(id: "grep", title: "grep", status: .success, duration: "1.2 s"),
                AedstTraceStep(id: "read", title: "Read files", status: .error, detail: "Permission denied"),
            ]
        ),
        AedstTraceStep(id: "edit", title: "Edit", status: .pending),
        AedstTraceStep(id: "test", title: "Run tests", status: .skipped),
    ])
    .padding()
}

#endif
