import AedstDesignSystem
import Nuke
import NukeUI
import SwiftUI

/// Remote image with a skeleton while loading and a placeholder on failure,
/// loaded through `AedstImagePipeline` (Nuke: disk + memory cache, downsampled
/// decode). Pass a `cacheKey` (media id + variant) whenever the URL is presigned
/// and therefore changes per call. No transition animation is applied, so Reduce
/// Motion is respected by construction.
public struct AedstRemoteImage: View {
    private let url: URL?
    private let cacheKey: String?
    private let maxPointSize: CGFloat
    private let contentMode: ContentMode
    private let accessibilityLabel: String?

    @Environment(\.displayScale) private var displayScale

    /// `maxPointSize` is the largest side the image is shown at, in points.
    public init(
        url: URL?,
        cacheKey: String? = nil,
        maxPointSize: CGFloat = 600,
        contentMode: ContentMode = .fill,
        accessibilityLabel: String? = nil
    ) {
        self.url = url
        self.cacheKey = cacheKey
        self.maxPointSize = maxPointSize
        self.contentMode = contentMode
        self.accessibilityLabel = accessibilityLabel
    }

    public var body: some View {
        ZStack {
            if let request {
                LazyImage(request: request) { state in
                    if let image = state.image {
                        image
                            .resizable()
                            .aspectRatio(contentMode: contentMode)
                            .accessibilityHidden(accessibilityLabel == nil)
                            .accessibilityLabel(Text(accessibilityLabel ?? ""))
                    } else if state.error != nil {
                        failureView
                    } else {
                        AedstSkeleton()
                    }
                }
                .pipeline(AedstImagePipeline.shared)
            } else {
                failureView
            }
        }
        .clipped()
    }

    private var request: ImageRequest? {
        guard let url else { return nil }
        var request = ImageRequest(url: url)
        request.imageID = cacheKey
        request.thumbnail = ImageRequest.ThumbnailOptions(
            maxPixelSize: Float((maxPointSize * displayScale).rounded(.up))
        )
        return request
    }

    private var failureView: some View {
        Image(systemName: "photo")
            .foregroundStyle(AedstColor.mutedForeground)
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .background(AedstColor.muted)
            .accessibilityLabel(Text(AedstCommonStrings.imageUnavailable))
    }
}
