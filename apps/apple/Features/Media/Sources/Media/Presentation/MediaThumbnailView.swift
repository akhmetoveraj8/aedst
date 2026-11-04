import AedstDesignSystem
import AedstMedia
import SwiftUI

/// Square thumbnail for a media item. Source order:
/// 1. server imgproxy variant for `preset` (nearest preset, or `POSTER` for video) —
///    cached by media id, because the signed URL changes on every fetch;
/// 2. the original image (downsampled) when ready but no variant exists;
/// 3. a locally generated video poster frame (`AVAssetImageGenerator`);
/// 4. a kind icon (processing / failed / audio / document).
public struct MediaThumbnailView: View {
    private let item: MediaItem
    private let side: CGFloat
    private let preset: MediaVariant.Kind
    @State private var poster: DecodedImage?
    @Environment(\.displayScale) private var displayScale

    /// `side` is the square's edge in points; `preset` is the imgproxy preset for this
    /// context (`.thumb64` tiny lists, `.avatar256` avatars and small tiles, `.card400` grids).
    public init(item: MediaItem, side: CGFloat = 96, preset: MediaVariant.Kind = .card400) {
        self.item = item
        self.side = side
        self.preset = preset
    }

    public var body: some View {
        ZStack {
            content
            if item.kind == .video {
                Image(systemName: "play.circle.fill")
                    .font(.title2)
                    .foregroundStyle(.white)
                    .shadow(radius: 2)
                    .accessibilityHidden(true)
            }
        }
        .frame(width: side, height: side)
        .background(AedstColor.muted)
        .clipShape(RoundedRectangle(cornerRadius: AedstRadius.md, style: .continuous))
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(item.filename))
        .aedstSensitive()
    }

    @ViewBuilder private var content: some View {
        if let variant = item.imageVariant(preset) {
            AedstRemoteImage(url: variant.url, cacheKey: "\(item.id)/\(variant.kind.rawValue)", maxPointSize: side)
        } else if item.kind == .image, item.status == .ready, let url = item.url {
            AedstRemoteImage(url: url, cacheKey: "\(item.id)/original", maxPointSize: side)
        } else if item.kind == .video, item.status == .ready, let url = item.url {
            Group {
                if let poster {
                    Image(decorative: poster.cgImage, scale: displayScale)
                        .resizable()
                        .aspectRatio(contentMode: .fill)
                } else {
                    AedstSkeleton()
                }
            }
            .task(id: item.id) {
                let pixels = side * displayScale
                poster = await ThumbnailGenerator.posterFrame(forVideoAt: url, maximumPixelSize: CGSize(width: pixels, height: pixels))
            }
        } else {
            Image(systemName: statusIcon)
                .font(.title2)
                .foregroundStyle(item.status == .failed ? AedstColor.destructive : AedstColor.mutedForeground)
        }
    }

    private var statusIcon: String {
        switch item.status {
        case .failed: return "exclamationmark.triangle"
        case .pendingUpload, .processing: return "hourglass"
        case .ready, .unknown: break
        }
        switch item.kind {
        case .audio: return "waveform"
        case .document: return "doc"
        case .video: return "film"
        case .image, .other: return "photo"
        }
    }
}
