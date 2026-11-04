import SwiftUI

/// Small status pill matching shadcn/ui `Badge`.
public enum AedstBadgeVariant {
    case `default`
    case secondary
    case destructive
    case outline
}

public struct AedstBadge: View {
    private let text: String
    private let variant: AedstBadgeVariant

    public init(_ text: String, variant: AedstBadgeVariant = .default) {
        self.text = text
        self.variant = variant
    }

    public var body: some View {
        Text(text)
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
            .accessibilityLabel(Text(text))
    }

    private var backgroundColor: Color {
        switch variant {
        case .default: AedstColor.primary
        case .secondary: AedstColor.secondary
        case .destructive: AedstColor.destructive
        case .outline: .clear
        }
    }

    private var foregroundColor: Color {
        switch variant {
        case .default: AedstColor.primaryForeground
        case .secondary: AedstColor.secondaryForeground
        case .destructive: AedstColor.destructiveForeground
        case .outline: AedstColor.foreground
        }
    }
}

#Preview("AedstBadge") {
    HStack(spacing: AedstSpacing.xs) {
        AedstBadge("New")
        AedstBadge("Draft", variant: .secondary)
        AedstBadge("Failed", variant: .destructive)
        AedstBadge("Beta", variant: .outline)
    }
    .padding()
}
