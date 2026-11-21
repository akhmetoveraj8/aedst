import SwiftUI

/// Mirrors shadcn/ui `Alert`'s `variant` prop (`ui-kit.yaml`: default, destructive).
public enum AedstAlertVariant: Sendable, CaseIterable {
    /// Neutral callout.
    case `default`
    /// An error or a destructive outcome.
    case destructive

    var systemImage: String {
        switch self {
        case .default: "info.circle.fill"
        case .destructive: "xmark.octagon.fill"
        }
    }

    var tint: Color {
        switch self {
        case .default: AedstColor.foreground
        case .destructive: AedstColor.destructive
        }
    }
}

/// Inline banner matching shadcn/ui `Alert` — distinct from the native
/// `.alert()` modal; use `AedstAlertDialog` for that. Success, warning and info feedback that goes away on its
/// own is a toast (`AedstToastData.severity`).
public struct AedstAlert: View {
    private let title: String
    private let message: String?
    private let variant: AedstAlertVariant
    private let systemImage: String?

    /// - Parameters:
    ///   - title: Already localized title.
    ///   - message: Optional description under the title.
    ///   - systemImage: SF Symbol that replaces the variant's default icon.
    public init(
        _ title: String,
        message: String? = nil,
        variant: AedstAlertVariant = .default,
        systemImage: String? = nil
    ) {
        self.title = title
        self.message = message
        self.variant = variant
        self.systemImage = systemImage
    }

    public var body: some View {
        HStack(alignment: .top, spacing: AedstSpacing.sm) {
            Image(systemName: systemImage ?? variant.systemImage)
                .foregroundStyle(variant.tint)
                .accessibilityHidden(true)

            VStack(alignment: .leading, spacing: AedstSpacing.xxs) {
                Text(title)
                    .font(AedstTypography.body.weight(.semibold))
                    .foregroundStyle(variant.tint)
                if let message {
                    Text(message)
                        .font(AedstTypography.caption)
                        .foregroundStyle(variant == .destructive ? AedstColor.destructive : AedstColor.mutedForeground)
                }
            }
        }
        .padding(AedstSpacing.sm)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(AedstColor.card)
        .clipShape(RoundedRectangle(cornerRadius: AedstRadius.md, style: .continuous))
        .overlay {
            RoundedRectangle(cornerRadius: AedstRadius.md, style: .continuous)
                .strokeBorder(variant == .default ? AedstColor.border : variant.tint.opacity(0.4), lineWidth: 1)
        }
        .accessibilityElement(children: .combine)
    }
}

#Preview("AedstAlert") {
    VStack(spacing: AedstSpacing.sm) {
        AedstAlert("Heads up", message: "You can add components to your app.")
        AedstAlert("Something went wrong", message: "Please try again.", variant: .destructive)
        AedstAlert("Saved", systemImage: "checkmark.circle.fill")
    }
    .padding()
}
