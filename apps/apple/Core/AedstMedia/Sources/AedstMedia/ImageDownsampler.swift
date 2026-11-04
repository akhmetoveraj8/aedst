import CoreGraphics
import Foundation
import ImageIO

/// A decoded, display-ready bitmap that can cross actor boundaries.
///
/// `CGImage` is immutable and documented as thread-safe, but its `Sendable`
/// annotation differs between SDK versions; this wrapper states the guarantee
/// once instead of relying on a particular SDK.
public struct DecodedImage: @unchecked Sendable {
    /// The bitmap (already oriented upright).
    public let cgImage: CGImage

    /// Wraps `cgImage`.
    public init(_ cgImage: CGImage) {
        self.cgImage = cgImage
    }

    /// Pixel width.
    public var pixelWidth: Int { cgImage.width }
    /// Pixel height.
    public var pixelHeight: Int { cgImage.height }
}

/// ImageIO downsampling: decodes straight to the target size instead of
/// inflating the full-resolution bitmap first (a 48 MP photo would otherwise
/// cost ~190 MB of memory just to show a 300 pt thumbnail). Applies the EXIF
/// orientation, and — because a thumbnail is a fresh bitmap — drops all
/// metadata, including GPS location.
public enum ImageDownsampler {
    /// Downsamples encoded image `data` so its longest side is at most `maxPixelSize`.
    public static func downsample(data: Data, maxPixelSize: Int) -> DecodedImage? {
        guard let source = CGImageSourceCreateWithData(data as CFData, sourceOptions) else { return nil }
        return thumbnail(from: source, maxPixelSize: maxPixelSize).map(DecodedImage.init)
    }

    /// Downsamples the image file at `fileURL`.
    public static func downsample(fileURL: URL, maxPixelSize: Int) -> DecodedImage? {
        guard let source = CGImageSourceCreateWithURL(fileURL as CFURL, sourceOptions) else { return nil }
        return thumbnail(from: source, maxPixelSize: maxPixelSize).map(DecodedImage.init)
    }

    /// Don't decode/cache the full image when the source is created.
    private static var sourceOptions: CFDictionary {
        [kCGImageSourceShouldCache: false] as CFDictionary
    }

    static func thumbnail(from source: CGImageSource, maxPixelSize: Int) -> CGImage? {
        let options: [CFString: Any] = [
            kCGImageSourceCreateThumbnailFromImageAlways: true,
            kCGImageSourceShouldCacheImmediately: true,
            kCGImageSourceCreateThumbnailWithTransform: true,
            kCGImageSourceThumbnailMaxPixelSize: max(1, maxPixelSize),
        ]
        return CGImageSourceCreateThumbnailAtIndex(source, 0, options as CFDictionary)
    }
}
