import AedstCore
import Foundation
import NotificationsDomain
import Observation

/// Delivery preferences. Each toggle saves immediately and rolls back if the
/// server rejects it. Turning push on also asks for OS permission.
@MainActor
@Observable
public final class NotificationPreferencesViewModel {
    public private(set) var preferences: NotificationPreferences?
    public private(set) var isSaving = false
    /// Bound to `aedstErrorPresenter`.
    public var error: AedstError?

    private let repository: any NotificationsRepository
    private let push: PushCoordinator

    /// Uses `push` to request OS permission when push is enabled.
    public init(repository: any NotificationsRepository, push: PushCoordinator) {
        self.repository = repository
        self.push = push
    }

    /// Loads the current preferences.
    public func load() async {
        switch await repository.preferences() {
        case .success(let preferences):
            self.preferences = preferences
        case .failure(let failure):
            error = failure
        }
    }

    /// Applies one change.
    public func update(_ keyPath: WritableKeyPath<NotificationPreferences, Bool>, to value: Bool) async {
        guard var updated = preferences else { return }
        let previous = updated
        updated[keyPath: keyPath] = value
        preferences = updated
        if updated.pushEnabled, !previous.pushEnabled {
            await push.enablePush()
        }
        isSaving = true
        defer { isSaving = false }
        switch await repository.updatePreferences(updated) {
        case .success(let saved):
            preferences = saved
        case .failure(let failure):
            preferences = previous
            error = failure
        }
    }
}
