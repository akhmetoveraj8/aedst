import AedstDesignSystem
import Nuke
import NukeUI
import SwiftUI

/// Circular user avatar with a remote image: fills the image slot of the design system's `AedstAvatar` from a
/// URL and keeps its monogram while loading or on failure. Lives in `Core/AedstMedia` (not the design system)
/// because remote images go through Nuke only here; call sites never reach for `AsyncImage`.
public struct AedstRemoteAvatar: View {
    private let name: String
    private let imageURL: URL?
    private let size: AedstAvatarSize

    @Environment(\.displayScale) private var displayScale

    public init(name: String, imageURL: URL? = nil, size: AedstAvatarSize = .default) {
        self.name = name
        self.imageURL = imageURL
        self.size = size
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
        if let request {
            AedstAvatar(name: name, size: size) {
                LazyImage(request: request) { state in
                    if let image = state.image {
                        image.resizable().scaledToFill()
                    }
                }
                .pipeline(AedstImagePipeline.shared)
            }
        } else {
            AedstAvatar(name: name, size: size)
        }
    }
}

#Preview("AedstRemoteAvatar") {
    HStack(spacing: AedstSpacing.sm) {
        AedstRemoteAvatar(name: "Eraj Akhmetov", size: .sm)
        AedstRemoteAvatar(name: "Eraj Akhmetov", size: .default)
        AedstRemoteAvatar(name: "Eraj Akhmetov", size: .lg)
    }
    .padding()
}
