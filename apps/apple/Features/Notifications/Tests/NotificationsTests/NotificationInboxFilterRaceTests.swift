import AedstCore
import Foundation
import Testing
@testable import Notifications

/// Forwards to `FakeNotificationsRepository`, but holds the first `list` call until `release()` so a test can
/// finish it after a later one. (UNVERIFIED: never compiled or run.)
private actor GatedNotificationsRepository: NotificationsRepository {
    private let base = FakeNotificationsRepository()
    private var gate: CheckedContinuation<Void, Never>?
    private var listCalls = 0
    private var firstListStarted: CheckedContinuation<Void, Never>?

    func seed(_ items: [InboxNotification], unread: Int) async { await base.seed(items, unread: unread) }

    /// Suspends until the gated first `list` call is in flight.
    func waitUntilFirstListStarted() async {
        if listCalls > 0 { return }
        await withCheckedContinuation { firstListStarted = $0 }
    }

    func release() {
        gate?.resume()
        gate = nil
    }

    func list(unreadOnly: Bool, pageToken: String?) async -> Outcome<Page<InboxNotification>> {
        listCalls += 1
        if listCalls == 1 {
            firstListStarted?.resume()
            firstListStarted = nil
            await withCheckedContinuation { gate = $0 }
        }
        return await base.list(unreadOnly: unreadOnly, pageToken: pageToken)
    }

    func unreadCount() async -> Outcome<Int> { await base.unreadCount() }
    func markRead(ids: [String]) async -> Outcome<Void> { await base.markRead(ids: ids) }
    func markAllRead() async -> Outcome<Int> { await base.markAllRead() }
    func preferences() async -> Outcome<NotificationPreferences> { await base.preferences() }
    func updatePreferences(_ preferences: NotificationPreferences) async -> Outcome<NotificationPreferences> {
        await base.updatePreferences(preferences)
    }
    func registerPushDevice(_ registration: APNsRegistration) async -> Outcome<String> {
        await base.registerPushDevice(registration)
    }
    func unregisterPushDevice(deviceID: String) async -> Outcome<Void> { await base.unregisterPushDevice(deviceID: deviceID) }
}

@Suite("NotificationInboxViewModel filter race")
@MainActor
struct NotificationInboxFilterRaceTests {
    private func item(_ id: String, read: Bool) -> InboxNotification {
        InboxNotification(id: id, kind: .system, title: id, body: "", link: "", createdAt: nil, isRead: read)
    }

    @Test("an older, slower reload never overwrites the list for the filter chosen after it")
    func olderReloadIsDropped() async {
        let repository = GatedNotificationsRepository()
        await repository.seed([item("read", read: true), item("unread", read: false)], unread: 1)
        let badge = UnreadBadgeModel(repository: repository)
        let model = NotificationInboxViewModel(repository: repository, badge: badge)

        let first = Task { await model.refresh() } // all notifications; held at the gate
        await repository.waitUntilFirstListStarted()
        model.unreadOnly = true // supersedes it: its own reload runs immediately and is not gated
        try? await Task.sleep(for: .milliseconds(50))
        await repository.release()
        await first.value

        #expect(model.notifications.map(\.id) == ["unread"])
        #expect(!model.isLoading)
    }
}
