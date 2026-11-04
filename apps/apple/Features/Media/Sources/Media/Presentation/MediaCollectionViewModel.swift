import AedstAnalytics
import AedstCore
import AedstMedia
import Foundation
import Observation

/// A list of media plus in-flight uploads. The same model backs the media
/// library (`taskID == nil`) and a task's attachments (`taskID` set: uploads
/// are attached to that task via `CreateUploadRequest.task_id`).
@MainActor
@Observable
public final class MediaCollectionViewModel {
    /// An upload shown as a progress row until it finishes.
    public struct UploadProgress: Identifiable, Equatable, Sendable {
        public let id: UUID
        public let filename: String
        public var phase: UploadPhase
    }

    public let taskID: String?
    public private(set) var items: [MediaItem] = []
    public private(set) var uploads: [UploadProgress] = []
    public private(set) var isLoading = false
    public private(set) var hasLoaded = false
    /// Bound to `aedstErrorPresenter`.
    public var error: AedstError?

    @ObservationIgnored private var nextPageToken: String?
    private let repository: any MediaRepository
    private let uploadMedia: UploadMediaUseCase
    private let analytics: AnalyticsClient

    /// `taskID` scopes the collection to one task's attachments.
    public init(
        taskID: String?,
        repository: any MediaRepository,
        uploader: any FileUploading,
        analytics: AnalyticsClient = NoopAnalyticsClient()
    ) {
        self.taskID = taskID
        self.repository = repository
        self.uploadMedia = UploadMediaUseCase(repository: repository, uploader: uploader)
        self.analytics = analytics
    }

    /// Reloads the first page.
    public func refresh() async {
        nextPageToken = nil
        await load(replacing: true)
    }

    /// Next page when `item` is the last one shown.
    public func loadMoreIfNeeded(after item: MediaItem) async {
        guard item.id == items.last?.id, nextPageToken != nil, !isLoading else { return }
        await load(replacing: false)
    }

    /// Uploads each picked file (sequentially, so progress is meaningful).
    public func upload(_ files: [PickedFile]) async {
        for file in files {
            let progressID = UUID()
            uploads.append(UploadProgress(id: progressID, filename: file.url.lastPathComponent, phase: .preparing))
            let result = await uploadMedia(file, taskID: taskID) { [weak self] phase in
                Task { @MainActor in self?.update(progressID, phase) }
            }
            uploads.removeAll { $0.id == progressID }
            switch result {
            case .success(let item):
                items.insert(item, at: 0)
                analytics.track(AnalyticsEvent(name: "media_uploaded", parameters: ["attached_to_task": taskID == nil ? "false" : "true"]))
            case .failure(let failure):
                error = failure
                analytics.recordError(failure, context: ["operation": "media_upload"])
            }
        }
    }

    /// Deletes `item`.
    public func delete(_ item: MediaItem) async {
        switch await repository.delete(id: item.id) {
        case .success:
            items.removeAll { $0.id == item.id }
        case .failure(let failure):
            error = failure
        }
    }

    private func update(_ id: UUID, _ phase: UploadPhase) {
        guard let index = uploads.firstIndex(where: { $0.id == id }) else { return }
        uploads[index].phase = phase
    }

    private func load(replacing: Bool) async {
        guard !isLoading else { return }
        isLoading = true
        defer {
            isLoading = false
            hasLoaded = true
        }
        switch await repository.list(taskID: taskID, pageToken: replacing ? nil : nextPageToken) {
        case .success(let page):
            items = replacing ? page.items : items + page.items
            nextPageToken = page.nextPageToken
        case .failure(let failure):
            error = failure
        }
    }
}
