import AedstDesignSystem
import Nuke
import NukeUI
import SwiftUI

/// Circular user avatar: remote image with a monogram fallback while loading or on failure. Lives in
/// `Core/AedstMedia` (not the design system) because remote images go through Nuke only here; call sites
/// never reach for `AsyncImage`.
public struct AedstAvatar: View {
    public enum Size {
        case sm
        case md
        case lg

        var dimension: Double {
            switch self {
            case .sm: 28
            case .md: 40
            case .lg: 56
            }
        }

        var font: Font {
            switch self {
            case .sm: AedstTypography.caption
            case .md: AedstTypography.body
            case .lg: AedstTypography.headline
            }
        }
    }

    private let name: String
    private let imageURL: URL?
    private let size: Size

    @Environment(\.displayScale) private var displayScale

    public init(name: String, imageURL: URL? = nil, size: Size = .md) {
        self.name = name
        self.imageURL = imageURL
        self.size = size
    }

    private var initials: String {
        let parts = name.split(separator: " ").prefix(2)
        return parts.compactMap(\.first).map(String.init).joined().uppercased()
    }

    private var monogram: some View {
        Text(initials)
            .font(size.font.weight(.medium))
            .foregroundStyle(AedstColor.mutedForeground)
    }

    private var request: ImageRequest? {
        guard let imageURL else { return nil }
        var request = ImageRequest(url: imageURL)
        request.thumbnail = ImageRequest.ThumbnailOptions(
            maxPixelSize: Float((size.dimension * displayScale).rounded(.up))
        )
        return request
    }

    public var body: some View {
        ZStack {
            Circle().fill(AedstColor.muted)
            if let request {
                LazyImage(request: request) { state in
                    if let image = state.image {
                        image.resizable().scaledToFill()
                    } else {
                        monogram
                    }
                }
                .pipeline(AedstImagePipeline.shared)
            } else {
                monogram
            }
        }
        .frame(width: size.dimension, height: size.dimension)
        .clipShape(Circle())
        .accessibilityLabel(Text(name))
        .accessibilityAddTraits(.isImage)
    }
}

#Preview("AedstAvatar") {
    HStack(spacing: AedstSpacing.sm) {
        AedstAvatar(name: "Eraj Akhmetov", size: .sm)
        AedstAvatar(name: "Eraj Akhmetov", size: .md)
        AedstAvatar(name: "Eraj Akhmetov", size: .lg)
    }
    .padding()
}
