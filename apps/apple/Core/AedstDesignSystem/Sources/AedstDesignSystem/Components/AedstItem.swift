import SwiftUI

/// Mirrors the `variant` props of shadcn/ui `Item` and `ItemMedia` (`ui-kit.yaml`: default, outline, muted, icon,
/// image). `default`, `outline` and `muted` style the row; `icon` and `image` style its media slot
/// (`AedstItemMedia`). A row given a media variant is drawn like `default`.
public enum AedstItemVariant: Sendable, CaseIterable {
    /// Row: no border, no fill. Media: shown as given.
    case `default`
    /// Row with a border.
    case outline
    /// Row with a muted fill.
    case muted
    /// Media: an SF Symbol at icon size.
    case icon
    /// Media: a clipped square thumbnail that follows the row size.
    case image
}

/// Mirrors shadcn/ui `Item`'s `size` prop (`ui-kit.yaml`: default, sm, xs).
public enum AedstItemSize: Sendable, CaseIterable {
    case `default`
    case sm
    case xs

    var spacing: CGFloat { self == .xs ? AedstSpacing.sm : AedstSpacing.md }
    var horizontalPadding: CGFloat { self == .xs ? AedstSpacing.md : AedstSpacing.lg }
    var verticalPadding: CGFloat { self == .xs ? AedstSpacing.sm : AedstSpacing.md }
    var descriptionFont: Font { self == .xs ? AedstTypography.caption : AedstTypography.body }

    /// Side of an `image` media thumbnail.
    var imageSide: CGFloat {
        switch self {
        case .default: AedstSpacing.huge
        case .sm: AedstSpacing.xxxl
        case .xs: AedstSpacing.xxl
        }
    }
}

/// Media slot of an `AedstItem` (shadcn/ui `ItemMedia`): wraps an icon or a thumbnail.
public struct AedstItemMedia<Content: View>: View {
    private let variant: AedstItemVariant
    private let size: AedstItemSize
    private let content: Content

    /// - Parameters:
    ///   - variant: `.icon` or `.image`; any other value shows the content as given.
    ///   - size: Pass the row's size so an `.image` thumbnail matches it.
    public init(variant: AedstItemVariant = .default, size: AedstItemSize = .default, @ViewBuilder content: () -> Content) {
        self.variant = variant
        self.size = size
        self.content = content()
    }

    public var body: some View {
        switch variant {
        case .icon:
            content
                .font(AedstTypography.body)
                .foregroundStyle(AedstColor.foreground)
        case .image:
            content
                .aedstScaledFrame(width: size.imageSide, height: size.imageSide)
                .clipShape(RoundedRectangle(cornerRadius: AedstRadius.sm, style: .continuous))
        case .default, .outline, .muted:
            content
        }
    }
}

/// List row matching shadcn/ui `Item`: media, title, description and trailing actions. Pass `action` to make
/// the whole row a button (a 44 pt target on touch platforms); without it the row is static content.
public struct AedstItem<Media: View, Actions: View>: View {
    private let title: String
    private let description: String?
    private let variant: AedstItemVariant
    private let size: AedstItemSize
    private let action: (() -> Void)?
    private let media: Media
    private let actions: Actions

    /// - Parameters:
    ///   - title: Already localized title.
    ///   - description: Optional second line (at most two lines, as on web).
    ///   - action: Makes the row tappable.
    ///   - media: Leading slot, usually an `AedstItemMedia`.
    ///   - actions: Trailing slot (buttons, a chevron, a badge).
    public init(
        _ title: String,
        description: String? = nil,
        variant: AedstItemVariant = .default,
        size: AedstItemSize = .default,
        action: (() -> Void)? = nil,
        @ViewBuilder media: () -> Media,
        @ViewBuilder actions: () -> Actions
    ) {
        self.title = title
        self.description = description
        self.variant = variant
        self.size = size
        self.action = action
        self.media = media()
        self.actions = actions()
    }

    public var body: some View {
        if let action {
            Button(action: action) {
                row.aedstHitTarget()
            }
            .buttonStyle(.plain)
        } else {
            row
        }
    }

    private var row: some View {
        HStack(alignment: .center, spacing: size.spacing) {
            media
            VStack(alignment: .leading, spacing: size == .xs ? AedstSpacing.none : AedstSpacing.xs) {
                Text(title)
                    .font(AedstTypography.body.weight(.medium))
                    .foregroundStyle(AedstColor.foreground)
                if let description {
                    Text(description)
                        .font(size.descriptionFont)
                        .foregroundStyle(AedstColor.mutedForeground)
                        .lineLimit(2)
                }
            }
            .multilineTextAlignment(.leading)
            .frame(maxWidth: .infinity, alignment: .leading)
            actions
        }
        .padding(.horizontal, size.horizontalPadding)
        .padding(.vertical, size.verticalPadding)
        .background(variant == .muted ? AedstColor.muted.opacity(0.5) : Color.clear)
        .clipShape(RoundedRectangle(cornerRadius: AedstRadius.md, style: .continuous))
        .overlay {
            if variant == .outline {
                RoundedRectangle(cornerRadius: AedstRadius.md, style: .continuous)
                    .strokeBorder(AedstColor.border, lineWidth: 1)
            }
        }
    }
}

extension AedstItem where Media == EmptyView, Actions == EmptyView {
    /// A row with text only.
    public init(
        _ title: String,
        description: String? = nil,
        variant: AedstItemVariant = .default,
        size: AedstItemSize = .default,
        action: (() -> Void)? = nil
    ) {
        self.init(title, description: description, variant: variant, size: size, action: action) {
            EmptyView()
        } actions: {
            EmptyView()
        }
    }
}

#Preview("AedstItem") {
    VStack(spacing: AedstSpacing.sm) {
        AedstItem("Basic item", description: "A row with a title and a description.")
        AedstItem("Outline", description: "Opens the details.", variant: .outline, action: {}) {
            AedstItemMedia(variant: .icon) { Image(systemName: "shield") }
        } actions: {
            Image(systemName: "chevron.forward").foregroundStyle(AedstColor.mutedForeground)
        }
        AedstItem("Muted, small", variant: .muted, size: .sm) {
            AedstItemMedia(variant: .image, size: .sm) { AedstColor.chart2 }
        } actions: {
            AedstButton("Open", variant: .outline, size: .sm, fillsWidth: false) {}
        }
        AedstItem("Extra small", description: "Dense lists and menus.", size: .xs)
    }
    .padding()
}
