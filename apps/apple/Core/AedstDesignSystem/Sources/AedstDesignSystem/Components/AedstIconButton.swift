import SwiftUI

/// Icon-only button — the `size: .icon` shape of `AedstButton`
/// pulled out as its own type for toolbar/list-row actions where a label
/// would never be shown, so call sites don't have to pass an empty title.
public struct AedstIconButton: View {
    private let systemImage: String
    private let accessibilityLabel: String
    private let variant: AedstButtonVariant
    private let size: AedstButtonSize
    private let isDisabled: Bool
    private let action: () -> Void

    public init(
        systemImage: String,
        accessibilityLabel: String,
        variant: AedstButtonVariant = .ghost,
        size: AedstButtonSize = .icon,
        isDisabled: Bool = false,
        action: @escaping () -> Void
    ) {
        self.systemImage = systemImage
        self.accessibilityLabel = accessibilityLabel
        self.variant = variant
        // Always one of the square sizes: a text size is mapped to its icon counterpart.
        self.size = switch size {
        case .xs, .iconXs: .iconXs
        case .sm, .iconSm: .iconSm
        case .lg, .iconLg: .iconLg
        case .default, .icon: .icon
        }
        self.isDisabled = isDisabled
        self.action = action
    }

    public var body: some View {
        AedstButton(
            accessibilityLabel,
            systemImage: systemImage,
            variant: variant,
            size: size,
            isDisabled: isDisabled,
            action: action
        )
        .accessibilityLabel(Text(accessibilityLabel))
    }
}

#Preview("AedstIconButton") {
    HStack(spacing: AedstSpacing.sm) {
        AedstIconButton(systemImage: "heart", accessibilityLabel: "Favorite") {}
        AedstIconButton(systemImage: "trash", accessibilityLabel: "Delete", variant: .destructive) {}
        AedstIconButton(systemImage: "square.and.arrow.up", accessibilityLabel: "Share", variant: .outline) {}
    }
    .padding()
}
