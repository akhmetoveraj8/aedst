import AedstCore
import AedstMedia
import Foundation
import Testing
import UniformTypeIdentifiers
@testable import Media

actor FakeMediaRepository: MediaRepository {
    private(set) var calls: [String] = []
    private(set) var lastRequest: UploadRequest?

    func createUpload(_ request: UploadRequest) async -> Outcome<UploadTicket> {
        calls.append("create")
        lastRequest = request
        let media = MediaItem(id: "m1", kind: .document, status: .pendingUpload, filename: request.filename)
        // swiftlint:disable:next force_unwrapping
        let url = URL(string: "https://storage.example/upload?sig=1")!
        return .success(UploadTicket(media: media, uploadURL: url, method: "PUT", headers: ["Content-Type": request.contentType]))
    }

    func completeUpload(id: String) async -> Outcome<MediaItem> {
        calls.append("complete:\(id)")
        return .success(MediaItem(id: id, kind: .document, status: .processing, filename: "notes.txt"))
    }

    func get(id: String) async -> Outcome<MediaItem> { .failure(.notFound) }
    func list(taskID: String?, pageToken: String?) async -> Outcome<Page<MediaItem>> { .success(Page(items: [], nextPageToken: nil)) }
    func delete(id: String) async -> Outcome<Void> { .success(()) }
}

final class FakeUploader: FileUploading, @unchecked Sendable {
    private let lock = NSLock()
    private var _uploads: [(URL, [String: String], String)] = []
    let status: Int

    init(status: Int = 200) { self.status = status }

    var uploads: [(URL, [String: String], String)] { lock.withLock { _uploads } }

    func upload(
        fileURL: URL,
        to destination: URL,
        method: String,
        headers: [String: String],
        taskDescription: String,
        progress: @escaping @Sendable (Double) -> Void
    ) async throws -> Int {
        lock.withLock { _uploads.append((destination, headers, taskDescription)) }
        progress(1)
        guard (200..<300).contains(status) else { throw AedstError.unavailable(reason: "HTTP \(status)") }
        return status
    }
}

@Suite("UploadMediaUseCase")
struct UploadMediaUseCaseTests {
    private func makeFile() throws -> PickedFile {
        let url = FileManager.default.temporaryDirectory.appendingPathComponent("\(UUID().uuidString).txt")
        try Data("abc".utf8).write(to: url)
        return PickedFile(url: url, contentType: .plainText)
    }

    @Test("CreateUpload → PUT (with the server's headers) → CompleteUpload, attached to the task")
    func fullProtocol() async throws {
        let repository = FakeMediaRepository()
        let uploader = FakeUploader()
        let file = try makeFile()

        let result = await UploadMediaUseCase(repository: repository, uploader: uploader)(file, taskID: "task-1")

        #expect(result.value?.id == "m1")
        #expect(await repository.calls == ["create", "complete:m1"])
        let request = try #require(await repository.lastRequest)
        #expect(request.taskID == "task-1")
        #expect(request.sizeBytes == 3)
        #expect(request.sha256 == "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad")
        #expect(uploader.uploads.first?.2 == "m1")
        #expect(uploader.uploads.first?.1["Content-Type"] == request.contentType)
        #expect(!FileManager.default.fileExists(atPath: file.url.path), "temporary copy is cleaned up")
    }

    @Test("a failed PUT never calls CompleteUpload")
    func failedTransfer() async throws {
        let repository = FakeMediaRepository()
        let result = await UploadMediaUseCase(repository: repository, uploader: FakeUploader(status: 403))(try makeFile(), taskID: nil)
        #expect(result.error != nil)
        #expect(await repository.calls == ["create"])
    }
}
