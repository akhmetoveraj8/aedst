import AedstCore
import AedstTesting
import Foundation
import Testing
@testable import Notifications

actor FakeNotificationsRepository: NotificationsRepository {
    var items: [InboxNotification] = []
    var unread = 0
    private(set) var markedRead: [[String]] = []
    private(set) var registrations: [APNsRegistration] = []
    private(set) var unregistered: [String] = []

    func seed(_ items: [InboxNotification], unread: Int) {
        self.items = items
        self.unread = unread
    }

    func list(unreadOnly: Bool, pageToken: String?) async -> Outcome<Page<InboxNotification>> {
        .success(Page(items: unreadOnly ? items.filter { !$0.isRead } : items, nextPageToken: nil))
    }

    func unreadCount() async -> Outcome<Int> { .success(unread) }

    func markRead(ids: [String]) async -> Outcome<Void> {
        markedRead.append(ids)
        unread -= ids.count
        return .success(())
    }

    func markAllRead() async -> Outcome<Int> {
        defer { unread = 0 }
        return .success(unread)
    }

    func preferences() async -> Outcome<NotificationPreferences> {
        .success(NotificationPreferences(pushEnabled: false, taskCompleted: true, taskDueSoon: true, mediaReady: true))
    }

    func updatePreferences(_ preferences: NotificationPreferences) async -> Outcome<NotificationPreferences> {
        .success(preferences)
    }

    func registerPushDevice(_ registration: APNsRegistration) async -> Outcome<String> {
        registrations.append(registration)
        return .success("device-1")
    }

    func unregisterPushDevice(deviceID: String) async -> Outcome<Void> {
        unregistered.append(deviceID)
        return .success(())
    }
}

/// Records app-icon badge updates (a reference type, so the @MainActor closure can mutate it).
@MainActor
final class BadgeRecorder {
    var values: [Int] = []
}

@Suite("Notifications")
@MainActor
struct NotificationsTests {
    private func item(_ id: String, read: Bool = false) -> InboxNotification {
        InboxNotification(id: id, kind: .taskCompleted, title: id, body: "", link: "/tasks/\(id)", createdAt: nil, isRead: read)
    }

    @Test("APNs device tokens are sent as lowercase hex")
    func hexToken() {
        #expect(APNsRegistration.hexString(from: Data([0x0A, 0xFF, 0x00])) == "0aff00")
    }

    @Test("opening an unread entry marks it read, lowers the badge and returns its link")
    func opensEntry() async {
        let repository = FakeNotificationsRepository()
        await repository.seed([item("a"), item("b", read: true)], unread: 1)
        let appBadge = BadgeRecorder()
        let badge = UnreadBadgeModel(repository: repository) { appBadge.values.append($0) }
        let model = NotificationInboxViewModel(repository: repository, badge: badge)

        await model.refresh()
        let link = await model.open(model.notifications[0])

        #expect(link == "/tasks/a")
        #expect(model.notifications[0].isRead)
        #expect(badge.unread == 0)
        #expect(appBadge.values.last == 0)
        #expect(await repository.markedRead == [["a"]])
    }

    @Test("a token is registered once, then unregistered on sign-out")
    func registersAndUnregisters() async {
        let repository = FakeNotificationsRepository()
        let store = InMemorySecureStore()
        let coordinator = PushCoordinator(
            repository: repository,
            store: store,
            configuration: .init(topic: "com.aedst.apple.ios", isSandbox: true, deviceName: "Test"),
            registerForRemoteNotifications: {}
        )

        await coordinator.didRegister(deviceToken: Data([0x01, 0x02]))
        await coordinator.didRegister(deviceToken: Data([0x01, 0x02]))
        await coordinator.unregister()

        let registrations = await repository.registrations
        #expect(registrations.count == 1)
        #expect(registrations.first?.token == "0102")
        #expect(registrations.first?.topic == "com.aedst.apple.ios")
        #expect(registrations.first?.isSandbox == true)
        #expect(await repository.unregistered == ["device-1"])
    }

    @Test("the push payload link is read from the top-level `link` key")
    func payloadLink() {
        #expect(PushCoordinator.link(fromPayload: ["aps": [:] as [String: String], "link": "/tasks/1"]) == "/tasks/1")
        #expect(PushCoordinator.link(fromPayload: ["link": ""]) == nil)
    }
}
