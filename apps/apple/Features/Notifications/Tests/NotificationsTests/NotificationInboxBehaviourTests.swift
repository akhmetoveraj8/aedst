import AedstAnalytics
import AedstCore
import Foundation
import Testing
@testable import Notifications

private final class RecordingAnalytics: AnalyticsClient, @unchecked Sendable {
    private let lock = NSLock()
    private var names: [String] = []
    var events: [String] { lock.withLock { names } }

    func track(_ event: AnalyticsEvent) { lock.withLock { names.append(event.name) } }
    func setUserID(_ userID: String?) {}
    func recordError(_ error: Error, context: [String: String]) {}
}

/// Records the app-icon badge values applied by `UnreadBadgeModel`.
@MainActor
private final class AppBadge {
    var values: [Int] = []
}

private func entry(_ id: String, read: Bool = false, link: String? = nil) -> InboxNotification {
    InboxNotification(
        id: id,
        kind: .system,
        title: id,
        body: "",
        link: link ?? "/tasks/\(id)",
        createdAt: nil,
        isRead: read
    )
}

@Suite("UnreadBadgeModel")
@MainActor
struct UnreadBadgeModelTests {
    @Test("refresh reads the server count and mirrors it on the app icon")
    func refresh() async {
        let repository = FakeNotificationsRepository()
        await repository.seed([], unread: 4)
        let appBadge = AppBadge()
        let model = UnreadBadgeModel(repository: repository) { appBadge.values.append($0) }

        await model.refresh()

        #expect(model.unread == 4)
        #expect(appBadge.values == [4])
    }

    @Test("a negative count is clamped to zero")
    func clamps() {
        let appBadge = AppBadge()
        let model = UnreadBadgeModel(repository: FakeNotificationsRepository()) { appBadge.values.append($0) }

        model.set(-3)

        #expect(model.unread == 0)
        #expect(appBadge.values == [0])
    }

    @Test("reset (sign-out) clears the badge")
    func reset() async {
        let repository = FakeNotificationsRepository()
        await repository.seed([], unread: 2)
        let appBadge = AppBadge()
        let model = UnreadBadgeModel(repository: repository) { appBadge.values.append($0) }
        await model.refresh()

        model.reset()

        #expect(model.unread == 0)
        #expect(appBadge.values.last == 0)
    }
}

@Suite("NotificationInboxViewModel (more)")
@MainActor
struct NotificationInboxBehaviourTests {
    private func makeModel(
        _ repository: FakeNotificationsRepository,
        analytics: RecordingAnalytics = RecordingAnalytics()
    ) -> (model: NotificationInboxViewModel, badge: UnreadBadgeModel) {
        let badge = UnreadBadgeModel(repository: repository)
        return (NotificationInboxViewModel(repository: repository, badge: badge, analytics: analytics), badge)
    }

    @Test("opening an already-read entry sends no mark-read request but still returns its link")
    func openRead() async {
        let repository = FakeNotificationsRepository()
        await repository.seed([entry("a", read: true)], unread: 0)
        let analytics = RecordingAnalytics()
        let (model, _) = makeModel(repository, analytics: analytics)
        await model.refresh()

        let link = await model.open(model.notifications[0])

        #expect(link == "/tasks/a")
        #expect(await repository.markedRead.isEmpty)
        #expect(analytics.events == ["notification_opened"])
    }

    @Test("an entry without a link opens nothing")
    func emptyLink() async {
        let repository = FakeNotificationsRepository()
        await repository.seed([entry("a", read: true, link: "")], unread: 0)
        let (model, _) = makeModel(repository)
        await model.refresh()

        #expect(await model.open(model.notifications[0]) == nil)
    }

    @Test("mark all read flips every row and zeroes the badge")
    func markAllRead() async {
        let repository = FakeNotificationsRepository()
        await repository.seed([entry("a"), entry("b"), entry("c", read: true)], unread: 2)
        let (model, badge) = makeModel(repository)
        await model.refresh()
        #expect(badge.unread == 2)

        await model.markAllRead()

        #expect(model.notifications.allSatisfy(\.isRead))
        #expect(badge.unread == 0)
        #expect(model.error == nil)
    }

    @Test("refresh loads the first page and marks the inbox as loaded")
    func refreshLoads() async {
        let repository = FakeNotificationsRepository()
        await repository.seed([entry("a"), entry("b")], unread: 2)
        let (model, badge) = makeModel(repository)
        #expect(!model.hasLoaded)

        await model.refresh()

        #expect(model.notifications.map(\.id) == ["a", "b"])
        #expect(model.hasLoaded)
        #expect(!model.isLoading)
        #expect(badge.unread == 2)
    }

    @Test("without a next page token, scrolling to the last row loads nothing more")
    func noMorePages() async {
        let repository = FakeNotificationsRepository()
        await repository.seed([entry("a")], unread: 1)
        let (model, _) = makeModel(repository)
        await model.refresh()

        await model.loadMoreIfNeeded(after: model.notifications[0])

        #expect(model.notifications.count == 1)
    }
}

@Suite("Notification push payload")
struct PushPayloadTests {
    @Test("a missing or non-string link yields nil")
    func linkVariants() {
        #expect(PushCoordinator.link(fromPayload: [:]) == nil)
        #expect(PushCoordinator.link(fromPayload: ["link": 42]) == nil)
        #expect(PushCoordinator.link(fromPayload: ["link": "/notifications"]) == "/notifications")
    }

    @Test("an empty device token still encodes to an empty string")
    func emptyToken() {
        #expect(APNsRegistration.hexString(from: Data()).isEmpty)
    }
}
