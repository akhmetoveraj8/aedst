import AedstCore
import Foundation
import MediaDomain
import Observation

/// One media item: always re-fetched on open, so presigned URLs are fresh.
@MainActor
@Observable
public final class MediaDetailViewModel {
    public let mediaID: String
    public private(set) var item: MediaItem?
    /// Bound to `aedstErrorPresenter`.
    public var error: AedstError?

    private let repository: any MediaRepository

    /// Loads `mediaID` from `repository`.
    public init(mediaID: String, repository: any MediaRepository) {
        self.mediaID = mediaID
        self.repository = repository
    }

    /// Fetches the item (fresh presigned URLs).
    public func load() async {
        switch await repository.get(id: mediaID) {
        case .success(let item):
            self.item = item
        case .failure(let failure):
            error = failure
        }
    }

    /// Deletes the item; `true` on success.
    public func delete() async -> Bool {
        switch await repository.delete(id: mediaID) {
        case .success:
            return true
        case .failure(let failure):
            error = failure
            return false
        }
    }
}
