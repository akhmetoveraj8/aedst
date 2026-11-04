import AVFoundation
import AedstCore
import Foundation
import ImageIO
import UniformTypeIdentifiers

/// A file produced for upload (in the temporary directory; delete it once uploaded).
public struct PreparedFile: Sendable, Equatable {
    /// Local file URL.
    public let url: URL
    /// MIME type sent as `CreateUploadRequest.content_type`.
    public let contentType: String
    /// Suggested filename (original base name + the new extension).
    public let filename: String

    /// Creates a prepared file description.
    public init(url: URL, contentType: String, filename: String) {
        self.url = url
        self.contentType = contentType
        self.filename = filename
    }

    /// Size on disk in bytes.
    public func sizeInBytes() throws -> Int64 {
        let values = try url.resourceValues(forKeys: [.fileSizeKey])
        return Int64(values.fileSize ?? 0)
    }
}

/// Client-side compression before upload: cuts upload time and storage, and
/// strips photo metadata (EXIF/GPS) because the output is a re-rendered bitmap.
/// The server still produces its own optimized variants; this only bounds what
/// leaves the device.
public enum MediaCompressor {
    /// Still-image output container.
    public enum ImageFormat: Sendable {
        /// HEIC when the device has a HEIC encoder, JPEG otherwise.
        case heic
        /// Always JPEG (maximum compatibility).
        case jpeg
    }

    /// Re-encodes the image at `source` with its longest side at most
    /// `maxPixelSize`, using ImageIO (`CGImageDestination`).
    public static func compressImage(
        at source: URL,
        maxPixelSize: Int = 2_048,
        quality: Double = 0.8,
        format: ImageFormat = .heic
    ) throws -> PreparedFile {
        guard let imageSource = CGImageSourceCreateWithURL(source as CFURL, nil),
              let image = ImageDownsampler.thumbnail(from: imageSource, maxPixelSize: maxPixelSize)
        else { throw AedstError.decoding(reason: "Unreadable image") }

        let type = outputType(for: format)
        let output = temporaryURL(extension: type.preferredFilenameExtension ?? "jpg")
        guard let destination = CGImageDestinationCreateWithURL(output as CFURL, type.identifier as CFString, 1, nil) else {
            throw AedstError.storage(reason: "Cannot create image destination")
        }
        let properties = [kCGImageDestinationLossyCompressionQuality: quality] as CFDictionary
        CGImageDestinationAddImage(destination, image, properties)
        guard CGImageDestinationFinalize(destination) else {
            throw AedstError.storage(reason: "Image encoding failed")
        }
        return PreparedFile(
            url: output,
            contentType: type.preferredMIMEType ?? "image/jpeg",
            filename: renamed(source, extension: output.pathExtension)
        )
    }

    /// Re-encodes the video at `source` with `AVAssetExportSession`, preferring
    /// HEVC 1080p and falling back to H.264 1080p/720p where HEVC is unavailable.
    public static func compressVideo(at source: URL) async throws -> PreparedFile {
        let asset = AVURLAsset(url: source)
        let compatible = AVAssetExportSession.exportPresets(compatibleWith: asset)
        let preferred = [AVAssetExportPresetHEVC1920x1080, AVAssetExportPreset1920x1080, AVAssetExportPreset1280x720]
        guard let preset = preferred.first(where: compatible.contains),
              let session = AVAssetExportSession(asset: asset, presetName: preset)
        else { throw AedstError.decoding(reason: "Video cannot be exported") }

        let output = temporaryURL(extension: "mp4")
        session.shouldOptimizeForNetworkUse = true

        try await session.export(to: output, as: .mp4)
        return PreparedFile(url: output, contentType: "video/mp4", filename: renamed(source, extension: "mp4"))
    }

    static func outputType(for format: ImageFormat) -> UTType {
        guard format == .heic else { return .jpeg }
        let encoders = (CGImageDestinationCopyTypeIdentifiers() as? [String]) ?? []
        return encoders.contains(UTType.heic.identifier) ? .heic : .jpeg
    }

    static func temporaryURL(extension pathExtension: String) -> URL {
        FileManager.default.temporaryDirectory
            .appendingPathComponent("aedst-upload-\(UUID().uuidString)")
            .appendingPathExtension(pathExtension)
    }

    static func renamed(_ source: URL, extension pathExtension: String) -> String {
        let base = source.deletingPathExtension().lastPathComponent
        return (base.isEmpty ? "upload" : base) + "." + pathExtension
    }
}
