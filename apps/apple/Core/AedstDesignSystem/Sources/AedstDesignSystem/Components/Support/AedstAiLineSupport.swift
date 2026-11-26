import SwiftUI

// iOS, macOS and visionOS only: tvOS and watchOS are scaffolded package platforms without app targets.
#if os(iOS) || os(macOS) || os(visionOS)

/// What leads a collapsible AI line or step: the caller's icon or the status icon.
enum AedstAiLeadingSymbol: Equatable, Sendable {
    case icon(String)
    case status(AedstTraceStatus)
}

/// Pure rules shared by the AI Elements lines (`AedstAiChainOfThought` and the components built on it), kept
/// apart from the views so they are unit-tested.
enum AedstAiLineLogic {
    /// Running and failed lines always show the status icon (spinner, cross); otherwise a caller icon wins
    /// over the status icon. No icon and no status: nothing (as on web).
    static func leadingSymbol(status: AedstTraceStatus?, systemImage: String?) -> AedstAiLeadingSymbol? {
        let forced = status == .running || status == .error
        if let systemImage, !forced {
            return .icon(systemImage)
        }
        guard systemImage != nil || status != nil else { return nil }
        return .status(status ?? .success)
    }

    /// The single sentence VoiceOver reads for a line: title, the status in words, then the description.
    static func spokenLabel(title: String, statusLabel: String?, description: String?) -> String {
        [title, statusLabel, description]
            .compactMap { $0 }
            .filter { !$0.isEmpty }
            .joined(separator: ", ")
    }

    /// Pending and skipped steps are drawn muted; the others in the foreground color.
    static func isMuted(_ status: AedstTraceStatus) -> Bool {
        status == .pending || status == .skipped
    }
}

/// Leading icon of an AI line or step (decorative: the status is spoken through the line's label).
struct AedstAiLeadingIcon: View {
    let symbol: AedstAiLeadingSymbol

    var body: some View {
        Group {
            switch symbol {
            case .icon(let name):
                Image(systemName: name)
                    .foregroundStyle(AedstColor.mutedForeground)
            case .status(.running):
                ProgressView()
                    .controlSize(.mini)
                    .tint(AedstTraceStatus.running.tint)
            case .status(let status):
                Image(systemName: status.systemImage)
                    .foregroundStyle(status.tint)
            }
        }
        .font(AedstTypography.body)
        .imageScale(.small)
        .frame(width: AedstSpacing.lg, height: AedstSpacing.lg)
        .accessibilityHidden(true)
    }
}

/// Wrapping row for badges (search results, a subagent's tools). SwiftUI has no flow layout, so this is the
/// minimal `Layout`; SwiftUI mirrors custom layouts in right-to-left environments.
struct AedstAiFlowLayout: Layout {
    var spacing: CGFloat = AedstSpacing.xs

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let rows = arrange(width: proposal.width ?? .infinity, subviews: subviews)
        let width = rows.map(\.width).max() ?? 0
        let height = rows.map(\.height).reduce(0, +) + spacing * CGFloat(max(rows.count - 1, 0))
        return CGSize(width: width, height: height)
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        var y = bounds.minY
        for row in arrange(width: bounds.width, subviews: subviews) {
            var x = bounds.minX
            for index in row.indices {
                let size = subviews[index].sizeThatFits(.unspecified)
                subviews[index].place(at: CGPoint(x: x, y: y), proposal: ProposedViewSize(size))
                x += size.width + spacing
            }
            y += row.height + spacing
        }
    }

    private struct Row {
        var indices: [Int] = []
        var width: CGFloat = 0
        var height: CGFloat = 0
    }

    private func arrange(width: CGFloat, subviews: Subviews) -> [Row] {
        var rows: [Row] = [Row()]
        for index in subviews.indices {
            let size = subviews[index].sizeThatFits(.unspecified)
            let needed = rows[rows.count - 1].indices.isEmpty ? size.width : rows[rows.count - 1].width + spacing + size.width
            if needed > width, !rows[rows.count - 1].indices.isEmpty {
                rows.append(Row())
            }
            var row = rows[rows.count - 1]
            row.width = row.indices.isEmpty ? size.width : row.width + spacing + size.width
            row.height = max(row.height, size.height)
            row.indices.append(index)
            rows[rows.count - 1] = row
        }
        return rows.filter { !$0.indices.isEmpty }
    }
}

#endif
