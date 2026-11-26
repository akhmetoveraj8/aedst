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

    /// - Parameter value: Fraction done, 0...1 (clamped); `nil` for an indeterminate indicator.
    public init(value: Double? = nil, style: Style = .linear, label: String? = nil) {
        self.value = Self.fraction(value)
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
                    Group {
                        if let value {
                            ProgressView(value: value, total: 1)
                        } else {
                            ProgressView()
                        }
                    }
                    .progressViewStyle(.circular)
                }
            }
            .tint(AedstColor.primary)
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(label ?? AedstStrings.progress))
        .accessibilityValue(Text(Self.percentValue(value) ?? ""))
    }

    /// The value clamped to 0...1, as web clamps `value` to the track; NaN counts as indeterminate.
    static func fraction(_ value: Double?) -> Double? {
        guard let value, !value.isNaN else { return nil }
        return min(max(value, 0), 1)
    }

    /// "60 %" for VoiceOver; `nil` while indeterminate.
    static func percentValue(_ fraction: Double?) -> String? {
        fraction.map { AedstStrings.percent(Int(($0 * 100).rounded())) }
    }
}

#Preview("AedstProgressView") {
    VStack(spacing: AedstSpacing.lg) {
        AedstProgressView(value: 0.6, label: "Uploading")
        AedstProgressView(style: .circular)
    }
    .padding()
}
