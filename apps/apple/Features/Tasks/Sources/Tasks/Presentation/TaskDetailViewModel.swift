import AedstAnalytics
import AedstCore
import Foundation
import Observation

/// One task: load, complete/reopen (the status state machine), delete.
@MainActor
@Observable
public final class TaskDetailViewModel {
    public let taskID: String
    public private(set) var task: TaskItem?
    public private(set) var isWorking = false
    /// Bound to `aedstErrorPresenter`.
    public var error: AedstError?

    private let repository: any TaskRepository
    private let analytics: AnalyticsClient
    private let clock: any AedstClock
    private let onChange: (TaskItem) -> Void
    private let onDelete: (String) -> Void

    /// `onChange`/`onDelete` let the list update without refetching.
    public init(
        taskID: String,
        repository: any TaskRepository,
        analytics: AnalyticsClient = NoopAnalyticsClient(),
        clock: any AedstClock = SystemClock(),
        onChange: @escaping (TaskItem) -> Void = { _ in },
        onDelete: @escaping (String) -> Void = { _ in }
    ) {
        self.taskID = taskID
        self.repository = repository
        self.analytics = analytics
        self.clock = clock
        self.onChange = onChange
        self.onDelete = onDelete
    }

    /// `true` when `task` is past its due date, judged by the injected clock (never the wall clock).
    public func isOverdue(_ task: TaskItem) -> Bool {
        task.isOverdue(at: clock.now)
    }

    /// Fetches the task.
    public func load() async {
        switch await repository.get(id: taskID) {
        case .success(let task):
            self.task = task
        case .failure(let failure):
            error = failure
        }
    }

    /// Completes an open task or reopens a done one.
    public func toggleCompletion() async {
        guard let task, !isWorking else { return }
        isWorking = true
        defer { isWorking = false }
        let result = task.status == .done
            ? await repository.reopen(id: task.id)
            : await repository.complete(id: task.id)
        switch result {
        case .success(let updated):
            self.task = updated
            onChange(updated)
            analytics.track(AnalyticsEvent(name: updated.status == .done ? "task_completed" : "task_reopened"))
        case .failure(let failure):
            error = failure
        }
    }

    /// Deletes the task; returns `true` on success.
    public func delete() async -> Bool {
        guard !isWorking else { return false }
        isWorking = true
        defer { isWorking = false }
        switch await repository.delete(id: taskID) {
        case .success:
            onDelete(taskID)
            return true
        case .failure(let failure):
            error = failure
            return false
        }
    }
}
