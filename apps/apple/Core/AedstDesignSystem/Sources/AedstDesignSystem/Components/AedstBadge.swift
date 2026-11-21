import SwiftUI

/// Mirrors shadcn/ui `Badge`'s `variant` prop (`ui-kit.yaml`: default, secondary, destructive, success, warning,
/// info, outline, ghost, link).
public enum AedstBadgeVariant: Sendable, CaseIterable {
    case `default`
    case secondary
    case destructive
    case success
    case warning
    case info
    case outline
    case ghost
    case link
}

/// Small status pill matching shadcn/ui `Badge`. The text carries the meaning; the colour only supports it.
public struct AedstBadge: View {
    private let text: String
    private let systemImage: String?
    private let variant: AedstBadgeVariant

    /// - Parameters:
    ///   - text: Visible, already localized text.
    ///   - systemImage: Optional SF Symbol shown before the text (decorative).
    public init(_ text: String, systemImage: String? = nil, variant: AedstBadgeVariant = .default) {
        self.text = text
        self.systemImage = systemImage
        self.variant = variant
    }

    public var body: some View {
        HStack(spacing: AedstSpacing.xs) {
            if let systemImage {
                Image(systemName: systemImage)
                    .accessibilityHidden(true)
            }
            Text(text)
                .underline(variant == .link)
        }
        .font(AedstTypography.caption.weight(.medium))
        .padding(.horizontal, AedstSpacing.sm)
        .padding(.vertical, AedstSpacing.xxs)
        .background(backgroundColor)
        .foregroundStyle(foregroundColor)
        .clipShape(Capsule())
        .overlay {
            if variant == .outline {
                Capsule().strokeBorder(AedstColor.border, lineWidth: 1)
            }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(text))
    }

    private var backgroundColor: Color {
        switch variant {
        case .default: AedstColor.primary
        case .secondary: AedstColor.secondary
        case .destructive: AedstColor.destructive
        case .success: AedstColor.success
        case .warning: AedstColor.warning
        case .info: AedstColor.info
        case .outline, .ghost, .link: .clear
        }
    }

    private var foregroundColor: Color {
        switch variant {
        case .default: AedstColor.primaryForeground
        case .secondary: AedstColor.secondaryForeground
        case .destructive: AedstColor.destructiveForeground
        case .success: AedstColor.successForeground
        case .warning: AedstColor.warningForeground
        case .info: AedstColor.infoForeground
        case .outline, .ghost: AedstColor.foreground
        case .link: AedstColor.primary
        }
    }
}

#Preview("AedstBadge") {
    VStack(alignment: .leading, spacing: AedstSpacing.xs) {
        HStack(spacing: AedstSpacing.xs) {
            AedstBadge("New")
            AedstBadge("Draft", variant: .secondary)
            AedstBadge("Failed", variant: .destructive)
        }
        HStack(spacing: AedstSpacing.xs) {
            AedstBadge("Done", systemImage: "checkmark", variant: .success)
            AedstBadge("Due soon", variant: .warning)
            AedstBadge("Info", variant: .info)
        }
        HStack(spacing: AedstSpacing.xs) {
            AedstBadge("Beta", variant: .outline)
            AedstBadge("Ghost", variant: .ghost)
            AedstBadge("Link", variant: .link)
        }
    }
    .padding()
}
