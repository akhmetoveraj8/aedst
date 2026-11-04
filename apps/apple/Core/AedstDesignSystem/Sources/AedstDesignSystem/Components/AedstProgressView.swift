import SwiftUI

/// Tokenized `ProgressView` wrapper (linear + circular) matching
/// shadcn/ui `Progress`.
public struct AedstProgressView: View {
    public enum Style {
        case linear
        case circular
    }

    private let value: Double?
    private let style: Style
    private let label: String?

    public init(value: Double? = nil, style: Style = .linear, label: String? = nil) {
        self.value = value
        self.style = style
        self.label = label
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: AedstSpacing.xxs) {
            if let label {
                Text(label)
                    .font(AedstTypography.caption)
                    .foregroundStyle(AedstColor.mutedForeground)
            }
            Group {
                switch style {
                case .linear:
                    if let value {
                        ProgressView(value: value, total: 1)
                    } else {
                        ProgressView()
                    }
                case .circular:
                    if let value {
                        ProgressView(value: value, total: 1)
                    } else {
                        ProgressView()
                    }
                    .progressViewStyle(.circular)
                }
            }
            .tint(AedstColor.primary)
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(label ?? AedstStrings.progress))
        .accessibilityValue(value.map { Text(AedstStrings.percent(Int($0 * 100))) } ?? Text(""))
    }
}

#Preview("AedstProgressView") {
    VStack(spacing: AedstSpacing.lg) {
        AedstProgressView(value: 0.6, label: "Uploading")
        AedstProgressView(style: .circular)
    }
    .padding()
}
