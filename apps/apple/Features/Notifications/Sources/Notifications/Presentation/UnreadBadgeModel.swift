import AedstCore
import Foundation
import Observation

/// The unread count shown on the home screen's inbox entry and mirrored on
/// the app icon (the platform call is injected: `UIApplication` badge on iOS,
/// the Dock tile on macOS).
@MainActor
@Observable
public final class UnreadBadgeModel {
    public private(set) var unread = 0

    private let repository: any NotificationsRepository
    private let setAppBadge: @MainActor (Int) -> Void

    /// `setAppBadge` applies the count to the app icon.
    public init(repository: any NotificationsRepository, setAppBadge: @escaping @MainActor (Int) -> Void = { _ in }) {
        self.repository = repository
        self.setAppBadge = setAppBadge
    }

    /// Fetches the count (failures keep the last known value).
    public func refresh() async {
        if case .success(let count) = await repository.unreadCount() {
            set(count)
        }
    }

    /// Applies a locally known count (after mark-read).
    public func set(_ count: Int) {
        unread = max(0, count)
        setAppBadge(unread)
    }

    /// Signed out: clear the badge.
    public func reset() {
        set(0)
    }
}
