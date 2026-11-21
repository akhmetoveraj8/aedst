import AedstAnalytics
import AedstCore
import Foundation
import Observation

/// The in-app inbox: paged list, unread filter, mark one/all read.
@MainActor
@Observable
public final class NotificationInboxViewModel {
    public private(set) var notifications: [InboxNotification] = []
    public private(set) var isLoading = false
    public private(set) var hasLoaded = false
    public var unreadOnly = false {
        didSet {
            guard unreadOnly != oldValue else { return }
            // A toggle supersedes an unfinished reload: cancel it so a slow, older answer never overwrites the new one.
            reloadTask?.cancel()
            reloadTask = Task { await refresh() }
        }
    }
    /// Bound to `aedstErrorPresenter`.
    public var error: AedstError?

    @ObservationIgnored private var reloadTask: Task<Void, Never>?
    @ObservationIgnored private var nextPageToken: String?
    /// Bumped by every load; an answer whose generation is no longer current is dropped.
    @ObservationIgnored private var generation = 0
    private let repository: any NotificationsRepository
    private let badge: UnreadBadgeModel
    private let analytics: AnalyticsClient

    /// `badge` is updated as items are read.
    public init(repository: any NotificationsRepository, badge: UnreadBadgeModel, analytics: AnalyticsClient = NoopAnalyticsClient()) {
        self.repository = repository
        self.badge = badge
        self.analytics = analytics
    }

    /// Reloads the first page and the badge.
    public func refresh() async {
        nextPageToken = nil
        await load(replacing: true)
        await badge.refresh()
    }

    /// Next page when `notification` is the last row shown.
    public func loadMoreIfNeeded(after notification: InboxNotification) async {
        guard notification.id == notifications.last?.id, nextPageToken != nil, !isLoading else { return }
        await load(replacing: false)
    }

    /// Marks `notification` read (optimistically) and returns its link to open.
    public func open(_ notification: InboxNotification) async -> String? {
        if !notification.isRead {
            setRead(ids: [notification.id])
            badge.set(badge.unread - 1)
            if case .failure(let failure) = await repository.markRead(ids: [notification.id]) {
                error = failure
                await refresh()
            }
        }
        analytics.track(AnalyticsEvent(name: "notification_opened", parameters: ["via": "inbox"]))
        return notification.link.isEmpty ? nil : notification.link
    }

    /// Marks everything read.
    public func markAllRead() async {
        switch await repository.markAllRead() {
        case .success:
            setRead(ids: Set(notifications.map(\.id)))
            if unreadOnly { notifications = [] }
            badge.set(0)
        case .failure(let failure):
            error = failure
        }
    }

    private func setRead(ids: Set<String>) {
        for index in notifications.indices where ids.contains(notifications[index].id) {
            notifications[index].isRead = true
        }
    }

    /// A page load never starts while another is running, but a reload (`replacing`) always does: it supersedes
    /// the running one, whose result is then discarded (it was fetched for another filter or an older state).
    private func load(replacing: Bool) async {
        if !replacing, isLoading { return }
        generation += 1
        let mine = generation
        let filter = unreadOnly
        isLoading = true
        let result = await repository.list(unreadOnly: filter, pageToken: replacing ? nil : nextPageToken)
        guard mine == generation else { return }
        isLoading = false
        hasLoaded = true
        guard filter == unreadOnly else { return }
        switch result {
        case .success(let page):
            notifications = replacing ? page.items : notifications + page.items
            nextPageToken = page.nextPageToken
        case .failure(let failure):
            error = failure
        }
    }
}
