import AedstCore
import AedstMedia
import Foundation
import UniformTypeIdentifiers

/// The transfer seam (`BackgroundUploader` in production, a fake in tests).
public protocol FileUploading: Sendable {
    func upload(
        fileURL: URL,
        to destination: URL,
        method: String,
        headers: [String: String],
        taskDescription: String,
        progress: @escaping @Sendable (Double) -> Void
    ) async throws -> Int
}

extension BackgroundUploader: FileUploading {}

/// Where an upload is.
public enum UploadPhase: Sendable, Equatable {
    case preparing
    case uploading(fraction: Double)
    case finishing
}

/// The media module's upload protocol, end to end:
///
/// 1. **Prepare** — compress (ImageIO HEIC/JPEG with a max pixel size; AVAssetExportSession
///    HEVC/H.264 for video; other files as-is), measure, SHA-256.
/// 2. **CreateUpload** — the server returns a presigned PUT URL + headers.
/// 3. **PUT** the bytes straight to object storage (background `URLSession`,
///    progress reported) — bytes never pass through the API server.
/// 4. **CompleteUpload** — the server verifies the object and starts processing
///    (variants arrive later; `MediaReady` notification when done).
public struct UploadMediaUseCase: Sendable {
    private let repository: any MediaRepository
    private let uploader: any FileUploading

    /// Uses `repository` for the RPCs and `uploader` for the transfer.
    public init(repository: any MediaRepository, uploader: any FileUploading) {
        self.repository = repository
        self.uploader = uploader
    }

    /// Uploads `file`, optionally attaching it to `taskID`.
    public func callAsFunction(
        _ file: PickedFile,
        taskID: String?,
        onPhase: @escaping @Sendable (UploadPhase) -> Void = { _ in }
    ) async -> Outcome<MediaItem> {
        onPhase(.preparing)
        let prepared: PreparedFile
        let size: Int64
        let sha256: String
        do {
            prepared = await Self.prepare(file)
            size = try prepared.sizeInBytes()
            sha256 = try FileHasher.sha256Hex(of: prepared.url)
        } catch {
            return .failure(.storage(reason: "Could not read the file: \(error)"))
        }
        defer { Self.cleanUp(file, prepared) }

        let ticket: UploadTicket
        switch await repository.createUpload(
            UploadRequest(filename: prepared.filename, contentType: prepared.contentType, sizeBytes: size, taskID: taskID, sha256: sha256)
        ) {
        case .success(let value): ticket = value
        case .failure(let error): return .failure(error)
        }

        do {
            onPhase(.uploading(fraction: 0))
            _ = try await uploader.upload(
                fileURL: prepared.url,
                to: ticket.uploadURL,
                method: ticket.method,
                headers: ticket.headers,
                taskDescription: ticket.media.id,
                progress: { onPhase(.uploading(fraction: $0)) }
            )
        } catch let error as AedstError {
            return .failure(error)
        } catch {
            return .failure(.unavailable(reason: String(describing: error)))
        }

        onPhase(.finishing)
        return await repository.completeUpload(id: ticket.media.id)
    }

    /// Compresses images/videos; falls back to the original file if that fails.
    static func prepare(_ file: PickedFile) async -> PreparedFile {
        if file.isImage, let compressed = try? MediaCompressor.compressImage(at: file.url) {
            return compressed
        }
        if file.isVideo, let compressed = try? await MediaCompressor.compressVideo(at: file.url) {
            return compressed
        }
        return PreparedFile(
            url: file.url,
            contentType: file.contentType.preferredMIMEType ?? "application/octet-stream",
            filename: file.url.lastPathComponent
        )
    }

    private static func cleanUp(_ file: PickedFile, _ prepared: PreparedFile) {
        try? FileManager.default.removeItem(at: file.url)
        if prepared.url != file.url {
            try? FileManager.default.removeItem(at: prepared.url)
        }
    }
}
