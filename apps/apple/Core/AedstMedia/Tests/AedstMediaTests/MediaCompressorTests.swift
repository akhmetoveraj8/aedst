import CoreGraphics
import Foundation
import ImageIO
import Testing
import UniformTypeIdentifiers
@testable import AedstMedia

@Suite("MediaCompressor / ImageDownsampler / FileHasher")
struct MediaCompressorTests {
    /// Writes a solid-colour PNG of the given size and returns its URL.
    private func makePNG(width: Int, height: Int) throws -> URL {
        let context = try #require(
            CGContext(
                data: nil,
                width: width,
                height: height,
                bitsPerComponent: 8,
                bytesPerRow: 0,
                space: CGColorSpaceCreateDeviceRGB(),
                bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
            )
        )
        context.setFillColor(CGColor(red: 0.2, green: 0.4, blue: 0.8, alpha: 1))
        context.fill(CGRect(x: 0, y: 0, width: width, height: height))
        let image = try #require(context.makeImage())
        let url = FileManager.default.temporaryDirectory.appendingPathComponent("\(UUID().uuidString).png")
        let destination = try #require(CGImageDestinationCreateWithURL(url as CFURL, UTType.png.identifier as CFString, 1, nil))
        CGImageDestinationAddImage(destination, image, nil)
        #expect(CGImageDestinationFinalize(destination))
        return url
    }

    @Test("compressImage bounds the longest side and re-encodes as JPEG")
    func compressesImage() throws {
        let source = try makePNG(width: 4_000, height: 1_000)
        let output = try MediaCompressor.compressImage(at: source, maxPixelSize: 1_000, format: .jpeg)
        defer { try? FileManager.default.removeItem(at: output.url) }

        #expect(output.contentType == "image/jpeg")
        #expect(output.filename.hasSuffix(".jpeg") || output.filename.hasSuffix(".jpg"))
        let decoded = try #require(ImageDownsampler.downsample(fileURL: output.url, maxPixelSize: 10_000))
        #expect(max(decoded.pixelWidth, decoded.pixelHeight) == 1_000)
    }

    @Test("downsample never exceeds the requested size")
    func downsamples() throws {
        let source = try makePNG(width: 800, height: 600)
        let image = try #require(ImageDownsampler.downsample(fileURL: source, maxPixelSize: 200))
        #expect(image.pixelWidth == 200)
        #expect(image.pixelHeight == 150)
    }

    @Test("sha256Hex matches the known digest of 'abc'")
    func hashes() throws {
        let url = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try Data("abc".utf8).write(to: url)
        #expect(try FileHasher.sha256Hex(of: url) == "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad")
    }
}
