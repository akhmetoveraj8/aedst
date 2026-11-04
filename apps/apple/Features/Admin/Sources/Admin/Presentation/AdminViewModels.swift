import AedstAnalytics
import AedstCore
import Foundation
import Observation

/// Overview numbers for the admin dashboard.
@MainActor
@Observable
public final class AdminDashboardViewModel {
    public private(set) var overview: AdminOverview?
    /// Bound to `aedstErrorPresenter` (`.forbidden` if the role was revoked).
    public var error: AedstError?
    private let repository: any AdminRepository

    /// Uses `repository`.
    public init(repository: any AdminRepository) {
        self.repository = repository
    }

    /// Fetches the overview.
    public func load() async {
        switch await repository.overview() {
        case .success(let overview): self.overview = overview
        case .failure(let failure): error = failure
        }
    }
}

/// Keyset-paged list state shared by the admin lists (plain value type).
public struct PagedList<Item: Sendable>: Sendable {
    public private(set) var items: [Item] = []
    public private(set) var nextPageToken: String?
    public private(set) var hasLoaded = false

    /// Applies a fetched page (replacing for the first page).
    mutating func apply(_ page: Page<Item>, replacing: Bool) {
        items = replacing ? page.items : items + page.items
        nextPageToken = page.nextPageToken
        hasLoaded = true
    }

    mutating func removeAll(where shouldRemove: (Item) -> Bool) {
        items.removeAll(where: shouldRemove)
    }
}

/// Any user's tasks, with audited deletion.
@MainActor
@Observable
public final class AdminTasksViewModel {
    public var query = ""
    public private(set) var list = PagedList<AdminTask>()
    public var error: AedstError?
    /// Task awaiting a deletion reason.
    public var pendingDeletion: AdminTask?
    public var deletionReason = ""
    private let repository: any AdminRepository
    private let analytics: AnalyticsClient

    /// Uses `repository`.
    public init(repository: any AdminRepository, analytics: AnalyticsClient = NoopAnalyticsClient()) {
        self.repository = repository
        self.analytics = analytics
    }

    /// Reason length rule from `DeleteTaskRequest.reason` (3...500).
    public var isReasonValid: Bool {
        (3...500).contains(deletionReason.trimmingCharacters(in: .whitespacesAndNewlines).count)
    }

    /// First page for the current query.
    public func search() async { await load(replacing: true) }

    /// Next page when `task` is last.
    public func loadMoreIfNeeded(after task: AdminTask) async {
        guard task.id == list.items.last?.id, list.nextPageToken != nil else { return }
        await load(replacing: false)
    }

    /// Deletes `pendingDeletion` with `deletionReason` (recorded in the audit log).
    public func confirmDeletion() async {
        guard let task = pendingDeletion, isReasonValid else { return }
        let reason = deletionReason.trimmingCharacters(in: .whitespacesAndNewlines)
        switch await repository.deleteTask(id: task.id, reason: reason) {
        case .success:
            list.removeAll { $0.id == task.id }
            analytics.track(AnalyticsEvent(name: "admin_task_deleted"))
        case .failure(let failure):
            error = failure
        }
        pendingDeletion = nil
        deletionReason = ""
    }

    private func load(replacing: Bool) async {
        let trimmed = query.trimmingCharacters(in: .whitespacesAndNewlines)
        switch await repository.tasks(query: trimmed, pageToken: replacing ? nil : list.nextPageToken) {
        case .success(let page): list.apply(page, replacing: replacing)
        case .failure(let failure): error = failure
        }
    }
}

/// The audit log, newest first.
@MainActor
@Observable
public final class AdminAuditLogViewModel {
    public private(set) var list = PagedList<AuditEntry>()
    public var error: AedstError?
    private let repository: any AdminRepository

    /// Uses `repository`.
    public init(repository: any AdminRepository) {
        self.repository = repository
    }

    /// First page.
    public func refresh() async { await load(replacing: true) }

    /// Next page when `entry` is last.
    public func loadMoreIfNeeded(after entry: AuditEntry) async {
        guard entry.id == list.items.last?.id, list.nextPageToken != nil else { return }
        await load(replacing: false)
    }

    private func load(replacing: Bool) async {
        switch await repository.auditLog(pageToken: replacing ? nil : list.nextPageToken) {
        case .success(let page): list.apply(page, replacing: replacing)
        case .failure(let failure): error = failure
        }
    }
}

/// Sends a SYSTEM notification to one user or everyone.
@MainActor
@Observable
public final class AdminBroadcastViewModel {
    public var draft = Broadcast()
    public private(set) var isSending = false
    /// Recipients of the last successful broadcast.
    public private(set) var lastRecipients: Int64?
    public var error: AedstError?
    private let repository: any AdminRepository

    /// Uses `repository`.
    public init(repository: any AdminRepository) {
        self.repository = repository
    }

    /// Sends `draft` and clears it on success.
    public func send() async {
        guard draft.isValid, !isSending else { return }
        isSending = true
        defer { isSending = false }
        switch await repository.broadcast(draft) {
        case .success(let recipients):
            lastRecipients = recipients
            draft = Broadcast()
        case .failure(let failure):
            error = failure
        }
    }
}
