import AedstAnalytics
import AedstCore
import Foundation
import Observation

/// The signed-in user's tasks: first page on appear, keyset pagination on
/// scroll, pull-to-refresh, and a minimal "new task" form.
@MainActor
@Observable
public final class TaskListViewModel {
    public private(set) var tasks: [TaskItem] = []
    public private(set) var isLoading = false
    public private(set) var hasLoaded = false
    /// Bound to `aedstErrorPresenter`.
    public var error: AedstError?

    /// New-task sheet state.
    public var isComposerPresented = false
    public var draftTitle = ""
    public var draftPriority: TaskItem.Priority = .medium
    public private(set) var isSaving = false
    /// Ids of rows that exist only in the outbox (created offline, not yet delivered): shown as "waiting to
    /// sync" and not openable, since the server does not know them yet.
    public private(set) var pendingIDs: Set<String> = []
    /// Queued writes the drainer gave up on (permanent failure): shown as "N changes were not synced".
    public private(set) var unsyncedCount = 0

    @ObservationIgnored private var nextPageToken: String?
    private let repository: any TaskRepository
    private let createTask: CreateTaskUseCase
    private let analytics: AnalyticsClient
    private let outbox: TaskOutboxQueue?
    private let clock: any AedstClock
    /// Stable per user intent (reset after each queued/created task), so a retried tap reuses one outbox id.
    @ObservationIgnored private var draftID = UUID().uuidString

    /// Uses `repository` for reads and writes. With an `outbox`, a create that fails for a retryable reason
    /// (offline, rate limited) is queued and shown optimistically instead of surfacing an error.
    public init(
        repository: any TaskRepository,
        analytics: AnalyticsClient = NoopAnalyticsClient(),
        outbox: TaskOutboxQueue? = nil,
        clock: any AedstClock = SystemClock()
    ) {
        self.repository = repository
        self.createTask = CreateTaskUseCase(repository: repository)
        self.analytics = analytics
        self.outbox = outbox
        self.clock = clock
    }

    /// `true` when `task` is past its due date, judged by the injected clock (never the wall clock).
    public func isOverdue(_ task: TaskItem) -> Bool {
        task.isOverdue(at: clock.now)
    }

    /// `true` while the draft can be submitted.
    public var canSaveDraft: Bool {
        !draftTitle.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && !isSaving
    }

    /// Reloads the first page.
    public func refresh() async {
        nextPageToken = nil
        await loadPage(replacing: true)
        await refreshUnsyncedCount()
    }

    /// Re-reads how many queued writes were parked as failed.
    public func refreshUnsyncedCount() async {
        unsyncedCount = await outbox?.failedCount() ?? 0
    }

    /// Loads the next page when `task` is the last row shown.
    public func loadMoreIfNeeded(after task: TaskItem) async {
        guard task.id == tasks.last?.id, nextPageToken != nil, !isLoading else { return }
        await loadPage(replacing: false)
    }

    /// Creates the drafted task and inserts it at the top.
    public func saveDraft() async {
        guard canSaveDraft else { return }
        isSaving = true
        defer { isSaving = false }
        switch await createTask(NewTask(title: draftTitle, priority: draftPriority), idempotencyKey: draftID) {
        case .success(let task):
            tasks.insert(task, at: 0)
            resetDraft()
            analytics.track(AnalyticsEvent(name: "task_created", parameters: ["priority": "\(task.priority)"]))
        case .failure(let failure):
            if await queueOffline(after: failure) { return }
            error = failure
        }
    }

    private func resetDraft() {
        draftTitle = ""
        draftPriority = .medium
        isComposerPresented = false
        draftID = UUID().uuidString
    }

    /// Queues the draft for later delivery when the failure is transient. Returns `true` when it did.
    private func queueOffline(after failure: AedstError) async -> Bool {
        guard let outbox, failure.isRetryable,
              let task = CreateTaskUseCase.normalized(NewTask(title: draftTitle, priority: draftPriority))
        else { return false }
        switch await outbox.enqueueCreate(task, id: draftID) {
        case .success(let id):
            tasks.insert(TaskItem(id: id, title: task.title, priority: task.priority), at: 0)
            pendingIDs.insert(id)
            resetDraft()
            analytics.track(AnalyticsEvent(name: "task_queued_offline"))
            return true
        case .failure:
            return false
        }
    }

    /// Reflects a change made on the detail screen without refetching.
    public func apply(_ task: TaskItem) {
        if let index = tasks.firstIndex(where: { $0.id == task.id }) {
            tasks[index] = task
        }
    }

    /// Removes a task deleted elsewhere.
    public func remove(id: String) {
        tasks.removeAll { $0.id == id }
    }

    private func loadPage(replacing: Bool) async {
        guard !isLoading else { return }
        isLoading = true
        defer {
            isLoading = false
            hasLoaded = true
        }
        switch await repository.list(search: "", pageToken: replacing ? nil : nextPageToken) {
        case .success(let page):
            tasks = replacing ? page.items : tasks + page.items
            if replacing { pendingIDs.removeAll() }
            nextPageToken = page.nextPageToken
        case .failure(let failure):
            error = failure
        }
    }
}
