import AedstAnalytics
import AedstCore
import AedstMedia
import Foundation
import Testing
import UniformTypeIdentifiers
@testable import Media

private final class RecordingAnalytics: AnalyticsClient, @unchecked Sendable {
    private let lock = NSLock()
    private var recorded: [AnalyticsEvent] = []
    private var errors: [String] = []
    var events: [AnalyticsEvent] { lock.withLock { recorded } }
    var errorOperations: [String] { lock.withLock { errors } }

    func track(_ event: AnalyticsEvent) { lock.withLock { recorded.append(event) } }
    func setUserID(_ userID: String?) {}
    func recordError(_ error: Error, context: [String: String]) {
        lock.withLock { errors.append(context["operation"] ?? "-") }
    }
}

/// Listing/deleting double (`FakeMediaRepository` in `UploadMediaUseCaseTests` covers uploads).
private actor ListingMediaRepository: MediaRepository {
    private var pages: [String?: Page<MediaItem>] = [:]
    private var deleteResult: Outcome<Void> = .success(())
    private(set) var listCalls: [String] = []
    private(set) var deleted: [String] = []

    func script(_ page: Page<MediaItem>, token: String?) { pages[token] = page }
    func script(delete: Outcome<Void>) { deleteResult = delete }

    func list(taskID: String?, pageToken: String?) async -> Outcome<Page<MediaItem>> {
        listCalls.append("\(taskID ?? "-")|\(pageToken ?? "-")")
        return pages[pageToken].map { .success($0) } ?? .failure(.unavailable(reason: "offline"))
    }

    func delete(id: String) async -> Outcome<Void> {
        deleted.append(id)
        return deleteResult
    }

    func createUpload(_ request: UploadRequest) async -> Outcome<UploadTicket> { .failure(.unsupported) }
    func completeUpload(id: String) async -> Outcome<MediaItem> { .failure(.unsupported) }
    func get(id: String) async -> Outcome<MediaItem> { .failure(.notFound) }
}

private func item(_ id: String) -> MediaItem {
    MediaItem(id: id, kind: .document, status: .ready, filename: "\(id).txt")
}

private func makeFile() throws -> PickedFile {
    let url = FileManager.default.temporaryDirectory.appendingPathComponent("\(UUID().uuidString).txt")
    try Data("abc".utf8).write(to: url)
    return PickedFile(url: url, contentType: .plainText)
}

@Suite("MediaCollectionViewModel")
@MainActor
struct MediaCollectionViewModelTests {
    @Test("refresh loads the first page for the task scope, paging appends, refresh starts over")
    func listsAndPages() async {
        let repository = ListingMediaRepository()
        await repository.script(Page(items: [item("a"), item("b")], nextPageToken: "p2"), token: nil)
        await repository.script(Page(items: [item("c")], nextPageToken: nil), token: "p2")
        let model = MediaCollectionViewModel(taskID: "task-1", repository: repository, uploader: FakeUploader())

        await model.refresh()
        await model.loadMoreIfNeeded(after: model.items[0]) // not the last item
        #expect(model.items.map(\.id) == ["a", "b"])

        await model.loadMoreIfNeeded(after: model.items[1])
        #expect(model.items.map(\.id) == ["a", "b", "c"])

        await model.refresh()
        #expect(model.items.map(\.id) == ["a", "b"])
        #expect(await repository.listCalls == ["task-1|-", "task-1|p2", "task-1|-"])
        #expect(model.hasLoaded)
    }

    @Test("a failed list is surfaced")
    func listFailure() async {
        let model = MediaCollectionViewModel(taskID: nil, repository: ListingMediaRepository(), uploader: FakeUploader())

        await model.refresh()

        #expect(model.error == .unavailable(reason: "offline"))
        #expect(model.items.isEmpty)
    }

    @Test("delete removes the item locally only when the server accepted it")
    func delete() async {
        let repository = ListingMediaRepository()
        await repository.script(Page(items: [item("a"), item("b")], nextPageToken: nil), token: nil)
        let model = MediaCollectionViewModel(taskID: nil, repository: repository, uploader: FakeUploader())
        await model.refresh()

        await repository.script(delete: .failure(.forbidden))
        await model.delete(model.items[0])
        #expect(model.items.count == 2)
        #expect(model.error == .forbidden)

        await repository.script(delete: .success(()))
        await model.delete(model.items[0])
        #expect(model.items.map(\.id) == ["b"])
        #expect(await repository.deleted == ["a", "a"])
    }

    @Test("a successful upload is inserted first, tracked, and leaves no progress row behind")
    func uploadSuccess() async throws {
        let analytics = RecordingAnalytics()
        let model = MediaCollectionViewModel(
            taskID: "task-1",
            repository: FakeMediaRepository(),
            uploader: FakeUploader(),
            analytics: analytics
        )

        await model.upload([try makeFile()])

        #expect(model.items.map(\.id) == ["m1"])
        #expect(model.uploads.isEmpty)
        #expect(analytics.events.map(\.name) == ["media_uploaded"])
        #expect(analytics.events.first?.parameters == ["attached_to_task": "true"])
    }

    @Test("a failed transfer is reported and recorded, and no item is added")
    func uploadFailure() async throws {
        let analytics = RecordingAnalytics()
        let model = MediaCollectionViewModel(
            taskID: nil,
            repository: FakeMediaRepository(),
            uploader: FakeUploader(status: 500),
            analytics: analytics
        )

        await model.upload([try makeFile()])

        #expect(model.items.isEmpty)
        #expect(model.uploads.isEmpty)
        #expect(model.error != nil)
        #expect(analytics.errorOperations == ["media_upload"])
        #expect(analytics.events.isEmpty)
    }
}
