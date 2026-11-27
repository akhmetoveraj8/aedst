import SwiftUI

/// Size of an `AedstAvatar`: web `avatar.tsx` `size` (sm 24, default 32, lg 40 points).
public enum AedstAvatarSize: Sendable, CaseIterable {
    case `default`
    case sm
    case lg

    /// Diameter in points.
    public var dimension: CGFloat {
        switch self {
        case .sm: 24
        case .default: 32
        case .lg: 40
        }
    }

    var font: Font {
        switch self {
        case .sm: AedstTypography.caption
        case .default, .lg: AedstTypography.body
        }
    }
}

/// Circular user avatar matching shadcn/ui `Avatar`: an image slot (`AvatarImage`) over a monogram
/// (`AvatarFallback`) built from the name.
///
/// The design system cannot load remote images (Nuke lives only in `Core/AedstMedia`), so the image is a slot:
/// pass a local `Image`, or use `AedstRemoteAvatar` from `AedstMedia`, which fills the slot from a URL and falls
/// back to this monogram. This file has no platform guard on purpose: it is used by `AedstMedia`.
public struct AedstAvatar<ImageContent: View>: View {
    private let name: String
    private let size: AedstAvatarSize
    private let image: ImageContent?

    /// - Parameters:
    ///   - name: Person or entity name: the accessibility label and the source of the initials.
    ///   - size: Diameter preset.
    ///   - image: Content drawn over the monogram and clipped to the circle; make it fill the frame
    ///     (`resizable().scaledToFill()`).
    public init(name: String, size: AedstAvatarSize = .default, @ViewBuilder image: () -> ImageContent) {
        self.name = name
        self.size = size
        self.image = image()
    }

    public var body: some View {
        ZStack {
            Circle().fill(AedstColor.muted)
            Text(AedstAvatarInitials.make(from: name))
                .font(size.font.weight(.medium))
                .foregroundStyle(AedstColor.mutedForeground)
            if let image {
                image
            }
        }
        .aedstScaledFrame(width: size.dimension, height: size.dimension)
        .clipShape(Circle())
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(name))
        .accessibilityAddTraits(.isImage)
    }
}

extension AedstAvatar where ImageContent == EmptyView {
    /// Monogram-only avatar.
    public init(name: String, size: AedstAvatarSize = .default) {
        self.name = name
        self.size = size
        self.image = nil
    }
}

/// Initials for the avatar fallback. Pure, so it is unit-tested.
public enum AedstAvatarInitials {
    /// First letters of the first two words, uppercased ("Ada Lovelace" -> "AL"); empty for a blank name.
    public static func make(from name: String) -> String {
        name.split(whereSeparator: \.isWhitespace)
            .prefix(2)
            .compactMap(\.first)
            .map(String.init)
            .joined()
            .uppercased()
    }
}

#Preview("AedstAvatar") {
    HStack(spacing: AedstSpacing.sm) {
        AedstAvatar(name: "Ada Lovelace", size: .sm)
        AedstAvatar(name: "Ada Lovelace")
        AedstAvatar(name: "Ada Lovelace", size: .lg) {
            Image(systemName: "person.fill")
                .resizable()
                .scaledToFit()
                .padding(AedstSpacing.md)
                .background(AedstColor.secondary)
        }
    }
    .padding()
}
