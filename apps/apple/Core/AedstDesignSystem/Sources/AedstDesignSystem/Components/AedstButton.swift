import SwiftUI

/// Mirrors shadcn/ui `Button`'s `variant` prop.
public enum AedstButtonVariant {
    case primary
    case secondary
    case destructive
    case outline
    case ghost
    case link
}

/// Mirrors shadcn/ui `Button`'s `size` prop.
public enum AedstButtonSize {
    case sm
    case md
    case lg
    case icon

    var minHeight: Double {
        switch self {
        case .sm: 36
        case .md: 44
        case .lg: 52
        case .icon: 44
        }
    }

    var horizontalPadding: CGFloat {
        switch self {
        case .sm: AedstSpacing.sm
        case .md: AedstSpacing.lg
        case .lg: AedstSpacing.xxl
        case .icon: 0
        }
    }

    var font: Font {
        switch self {
        case .sm: AedstTypography.caption
        case .md, .icon: AedstTypography.body
        case .lg: AedstTypography.headline
        }
    }
}

/// The one button every feature uses instead of bare `Button { }`, so hit
/// targets, corner radius and the loading-spinner-in-place-of-title behavior
/// stay consistent. Platform-adaptive: `.buttonStyle(.plain)` on macOS to
/// opt out of the default bordered chrome that would clash with our own
/// background.
public struct AedstButton: View {
    private let title: String
    private let systemImage: String?
    private let variant: AedstButtonVariant
    private let size: AedstButtonSize
    private let isLoading: Bool
    private let isDisabled: Bool
    private let action: () -> Void

    public init(
        _ title: String,
        systemImage: String? = nil,
        variant: AedstButtonVariant = .primary,
        size: AedstButtonSize = .md,
        isLoading: Bool = false,
        isDisabled: Bool = false,
        action: @escaping () -> Void
    ) {
        self.title = title
        self.systemImage = systemImage
        self.variant = variant
        self.size = size
        self.isLoading = isLoading
        self.isDisabled = isDisabled
        self.action = action
    }

    public var body: some View {
        Button(action: action) {
            ZStack {
                HStack(spacing: AedstSpacing.xs) {
                    if let systemImage {
                        Image(systemName: systemImage)
                    }
                    if size != .icon {
                        Text(title)
                    }
                }
                .font(size.font.weight(.semibold))
                .opacity(isLoading ? 0 : 1)

                if isLoading {
                    ProgressView()
                        .tint(foregroundColor)
                }
            }
            .frame(maxWidth: size == .icon ? nil : .infinity, minHeight: size.minHeight)
            .frame(minWidth: size == .icon ? size.minHeight : nil)
            .padding(.horizontal, size.horizontalPadding)
        }
        .disabled(isLoading || isDisabled)
        .background(backgroundColor)
        .foregroundStyle(foregroundColor)
        .clipShape(RoundedRectangle(cornerRadius: AedstRadius.md, style: .continuous))
        .overlay {
            if variant == .outline {
                RoundedRectangle(cornerRadius: AedstRadius.md, style: .continuous)
                    .strokeBorder(AedstColor.border, lineWidth: 1)
            }
        }
        .opacity(isDisabled ? 0.5 : 1)
        #if os(macOS)
        .buttonStyle(.plain)
        #endif
        // `Button` already exposes the button trait; the label is set explicitly
        // because the visible title is hidden (opacity 0) while loading and
        // absent for `.icon`.
        .accessibilityLabel(Text(title))
    }

    private var backgroundColor: Color {
        switch variant {
        case .primary: AedstColor.primary
        case .secondary: AedstColor.secondary
        case .destructive: AedstColor.destructive
        case .outline, .ghost, .link: .clear
        }
    }

    private var foregroundColor: Color {
        switch variant {
        case .primary: AedstColor.primaryForeground
        case .secondary: AedstColor.secondaryForeground
        case .destructive: AedstColor.destructiveForeground
        case .outline, .ghost: AedstColor.foreground
        case .link: AedstColor.primary
        }
    }
}

#Preview("AedstButton — Light") {
    VStack(spacing: AedstSpacing.sm) {
        AedstButton("Continue", variant: .primary) {}
        AedstButton("Secondary", variant: .secondary) {}
        AedstButton("Delete", variant: .destructive) {}
        AedstButton("Outline", variant: .outline) {}
        AedstButton("Ghost", variant: .ghost) {}
        AedstButton("Learn more", variant: .link) {}
        AedstButton("Loading", isLoading: true) {}
        AedstButton("Disabled", isDisabled: true) {}
        AedstButton("Add", systemImage: "plus", size: .icon) {}
    }
    .padding()
    .preferredColorScheme(.light)
}

#Preview("AedstButton — Dark") {
    VStack(spacing: AedstSpacing.sm) {
        AedstButton("Continue", variant: .primary) {}
        AedstButton("Secondary", variant: .secondary) {}
        AedstButton("Delete", variant: .destructive) {}
        AedstButton("Outline", variant: .outline) {}
    }
    .padding()
    .preferredColorScheme(.dark)
}
