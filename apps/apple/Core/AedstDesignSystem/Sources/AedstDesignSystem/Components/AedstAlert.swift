import SwiftUI

/// Inline banner matching shadcn/ui `Alert` — distinct from the native
/// `.alert()` modal; use `AedstAlertDialog` for that.
public enum AedstAlertSeverity {
    case info
    case success
    case warning
    case destructive

    var systemImage: String {
        switch self {
        case .info: "info.circle.fill"
        case .success: "checkmark.circle.fill"
        case .warning: "exclamationmark.triangle.fill"
        case .destructive: "xmark.octagon.fill"
        }
    }

    var tint: Color {
        switch self {
        case .info: AedstColor.foreground
        case .success: AedstColor.success
        case .warning: AedstColor.warning
        case .destructive: AedstColor.destructive
        }
    }
}

public struct AedstAlert: View {
    private let title: String
    private let message: String?
    private let severity: AedstAlertSeverity

    public init(_ title: String, message: String? = nil, severity: AedstAlertSeverity = .info) {
        self.title = title
        self.message = message
        self.severity = severity
    }

    public var body: some View {
        HStack(alignment: .top, spacing: AedstSpacing.sm) {
            Image(systemName: severity.systemImage)
                .foregroundStyle(severity.tint)

            VStack(alignment: .leading, spacing: AedstSpacing.xxs) {
                Text(title)
                    .font(AedstTypography.body.weight(.semibold))
                if let message {
                    Text(message)
                        .font(AedstTypography.caption)
                        .foregroundStyle(AedstColor.mutedForeground)
                }
            }
        }
        .padding(AedstSpacing.sm)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(AedstColor.card)
        .clipShape(RoundedRectangle(cornerRadius: AedstRadius.md, style: .continuous))
        .overlay {
            RoundedRectangle(cornerRadius: AedstRadius.md, style: .continuous)
                .strokeBorder(severity == .info ? AedstColor.border : severity.tint.opacity(0.4), lineWidth: 1)
        }
        .accessibilityElement(children: .combine)
    }
}

#Preview("AedstAlert") {
    VStack(spacing: AedstSpacing.sm) {
        AedstAlert("Heads up", message: "You can add components to your app.", severity: .info)
        AedstAlert("Saved", message: "Your changes are live.", severity: .success)
        AedstAlert("Low storage", message: "You're at 90% capacity.", severity: .warning)
        AedstAlert("Something went wrong", message: "Please try again.", severity: .destructive)
    }
    .padding()
}
