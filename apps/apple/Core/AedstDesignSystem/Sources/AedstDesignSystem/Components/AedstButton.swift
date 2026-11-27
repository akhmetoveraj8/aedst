import SwiftUI

/// Mirrors shadcn/ui `Button`'s `variant` prop (`ui-kit.yaml`: default, outline, secondary, ghost, destructive, link).
public enum AedstButtonVariant: Sendable, CaseIterable {
    /// Filled with the primary colour: the main action of a screen.
    case `default`
    /// Transparent with a border.
    case outline
    /// Filled with the secondary colour.
    case secondary
    /// No chrome until pressed or hovered.
    case ghost
    /// Filled with the destructive colour: deletes and other irreversible actions.
    case destructive
    /// Looks like an inline link.
    case link
}

/// Mirrors shadcn/ui `Button`'s `size` prop (`ui-kit.yaml`: default, xs, sm, lg, icon, icon-xs, icon-sm, icon-lg).
/// The `icon*` sizes are square and show only the symbol; the title stays the accessibility label.
public enum AedstButtonSize: Sendable, CaseIterable {
    case `default`
    case xs
    case sm
    case lg
    case icon
    case iconXs
    case iconSm
    case iconLg

    /// `true` for the square, symbol-only sizes.
    public var isIconOnly: Bool {
        switch self {
        case .icon, .iconXs, .iconSm, .iconLg: true
        case .default, .xs, .sm, .lg: false
        }
    }

    /// Height of the drawn chrome. The tappable area is never smaller than 44 pt on touch platforms.
    var minHeight: CGFloat {
        switch self {
        case .xs, .iconXs: 28
        case .sm, .iconSm: 36
        case .default, .icon: 44
        case .lg, .iconLg: 52
        }
    }

    var horizontalPadding: CGFloat {
        switch self {
        case .xs: AedstSpacing.sm
        case .sm: AedstSpacing.md
        case .default: AedstSpacing.lg
        case .lg: AedstSpacing.xxl
        case .icon, .iconXs, .iconSm, .iconLg: AedstSpacing.none
        }
    }

    var font: Font {
        switch self {
        case .xs, .iconXs, .sm, .iconSm: AedstTypography.caption
        case .default, .icon: AedstTypography.body
        case .lg, .iconLg: AedstTypography.headline
        }
    }

    var cornerRadius: CGFloat {
        switch self {
        case .xs, .iconXs: AedstRadius.sm
        case .default, .sm, .lg, .icon, .iconSm, .iconLg: AedstRadius.md
        }
    }
}

/// The one button every feature uses instead of bare `Button { }`, so hit
/// targets, corner radius and the loading-spinner-in-place-of-title behavior
/// stay consistent. Every platform uses `AedstPressableButtonStyle` (our own chrome, a pressed and hover wash,
/// a visible focus ring); control heights scale with Dynamic Type.
public struct AedstButton: View {
    private let title: String
    private let systemImage: String?
    private let variant: AedstButtonVariant
    private let size: AedstButtonSize
    private let isLoading: Bool
    private let isDisabled: Bool
    private let fillsWidth: Bool
    private let action: () -> Void

    /// - Parameters:
    ///   - title: Visible title; for the `icon*` sizes it is only the accessibility label.
    ///   - systemImage: SF Symbol shown before the title (required to see anything at an `icon*` size).
    ///   - fillsWidth: Text buttons stretch to the available width (the kit default on Apple); pass `false`
    ///     to hug the content, for example in a toolbar or a button group. The `icon*` sizes never stretch.
    public init(
        _ title: String,
        systemImage: String? = nil,
        variant: AedstButtonVariant = .default,
        size: AedstButtonSize = .default,
        isLoading: Bool = false,
        isDisabled: Bool = false,
        fillsWidth: Bool = true,
        action: @escaping () -> Void
    ) {
        self.title = title
        self.systemImage = systemImage
        self.variant = variant
        self.size = size
        self.isLoading = isLoading
        self.isDisabled = isDisabled
        self.fillsWidth = fillsWidth
        self.action = action
    }

    public var body: some View {
        Button(action: action) {
            chrome.aedstHitTarget()
        }
        .disabled(isLoading || isDisabled)
        // Pressed and hover washes and a visible focus ring on every platform (the plain style has none).
        .buttonStyle(AedstPressableButtonStyle(cornerRadius: size.cornerRadius))
        // `Button` already exposes the button trait; the label is set explicitly
        // because the visible title is hidden (opacity 0) while loading and
        // absent for the `icon*` sizes.
        .accessibilityLabel(Text(title))
        // While loading the control is disabled; the value tells VoiceOver why ("Loading").
        .accessibilityValue(Text(Self.accessibilityValue(isLoading: isLoading)))
        .accessibilityAddTraits(isLoading ? .updatesFrequently : [])
    }

    /// What VoiceOver reads after the label: "Loading" while busy, nothing otherwise.
    static func accessibilityValue(isLoading: Bool) -> String {
        isLoading ? AedstStrings.loading : ""
    }

    /// A disabled button keeps readable contrast: muted token colours instead of a half-transparent copy of the
    /// enabled colours (which fell below 4.5:1 on muted text). A loading button is not "disabled" visually.
    private var showsDisabled: Bool { isDisabled && !isLoading }

    private var stretches: Bool { fillsWidth && !size.isIconOnly }

    private var chrome: some View {
        ZStack {
            HStack(spacing: AedstSpacing.xs) {
                if let systemImage {
                    Image(systemName: systemImage)
                }
                if !size.isIconOnly {
                    Text(title)
                        .underline(variant == .link)
                }
            }
            .font(size.font.weight(.semibold))
            .opacity(isLoading ? 0 : 1)

            if isLoading {
                ProgressView()
                    .tint(foregroundColor)
            }
        }
        .aedstScaledMinFrame(minHeight: size.minHeight)
        .frame(maxWidth: stretches ? .infinity : nil)
        .aedstScaledMinFrame(minWidth: size.isIconOnly ? size.minHeight : nil)
        .padding(.horizontal, size.horizontalPadding)
        .background(backgroundColor)
        .foregroundStyle(foregroundColor)
        .clipShape(RoundedRectangle(cornerRadius: size.cornerRadius, style: .continuous))
        .overlay {
            if variant == .outline {
                RoundedRectangle(cornerRadius: size.cornerRadius, style: .continuous)
                    .strokeBorder(showsDisabled ? AedstColor.input : AedstColor.border, lineWidth: 1)
            }
        }
    }

    private var backgroundColor: Color {
        if showsDisabled {
            switch variant {
            case .default, .secondary, .destructive: return AedstColor.muted
            case .outline, .ghost, .link: return .clear
            }
        }
        switch variant {
        case .default: AedstColor.primary
        case .secondary: AedstColor.secondary
        case .destructive: AedstColor.destructive
        case .outline, .ghost, .link: .clear
        }
    }

    private var foregroundColor: Color {
        if showsDisabled { return AedstColor.mutedForeground }
        switch variant {
        case .default: AedstColor.primaryForeground
        case .secondary: AedstColor.secondaryForeground
        case .destructive: AedstColor.destructiveForeground
        case .outline, .ghost: AedstColor.foreground
        case .link: AedstColor.primary
        }
    }
}

#Preview("AedstButton — Light") {
    VStack(spacing: AedstSpacing.sm) {
        AedstButton("Continue", variant: .default) {}
        AedstButton("Secondary", variant: .secondary) {}
        AedstButton("Delete", variant: .destructive) {}
        AedstButton("Outline", variant: .outline) {}
        AedstButton("Ghost", variant: .ghost) {}
        AedstButton("Learn more", variant: .link) {}
        AedstButton("Loading", isLoading: true) {}
        AedstButton("Disabled", isDisabled: true) {}
        HStack(spacing: AedstSpacing.sm) {
            AedstButton("Extra small", size: .xs, fillsWidth: false) {}
            AedstButton("Small", size: .sm, fillsWidth: false) {}
            AedstButton("Add", systemImage: "plus", size: .iconXs) {}
            AedstButton("Add", systemImage: "plus", size: .iconSm) {}
            AedstButton("Add", systemImage: "plus", size: .icon) {}
            AedstButton("Add", systemImage: "plus", size: .iconLg) {}
        }
        AedstButton("Large", size: .lg) {}
    }
    .padding()
    .preferredColorScheme(.light)
}

#Preview("AedstButton — Dark") {
    VStack(spacing: AedstSpacing.sm) {
        AedstButton("Continue", variant: .default) {}
        AedstButton("Secondary", variant: .secondary) {}
        AedstButton("Delete", variant: .destructive) {}
        AedstButton("Outline", variant: .outline) {}
    }
    .padding()
    .preferredColorScheme(.dark)
}
