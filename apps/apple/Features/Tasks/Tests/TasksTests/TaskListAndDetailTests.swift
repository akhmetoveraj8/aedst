import AedstAnalytics
import AedstCore
import AedstNavigation
import Foundation
import Testing
@testable import Tasks

private final class RecordingAnalytics: AnalyticsClient, @unchecked Sendable {
    private let lock = NSLock()
    private var names: [String] = []
    var events: [String] { lock.withLock { names } }

    func track(_ event: AnalyticsEvent) { lock.withLock { names.append(event.name) } }
    func setUserID(_ userID: String?) {}
    func recordError(_ error: Error, context: [String: String]) {}
}

/// Collects the callbacks a detail view model makes (reference type: the closures are `@escaping`).
@MainActor
private final class DetailCallbacks {
    var changed: [TaskItem] = []
    var deleted: [String] = []
}

@Suite("TaskListViewModel (composer and local updates)")
@MainActor
struct TaskListViewModelTests {
    @Test("a blank draft cannot be saved and saving does nothing")
    func blankDraft() async {
        let repository = FakeTaskRepository()
        let model = TaskListViewModel(repository: repository)
        model.draftTitle = "   "

        #expect(!model.canSaveDraft)
        await model.saveDraft()

        #expect(await repository.createdTitles.isEmpty)
        #expect(model.tasks.isEmpty)
    }

    @Test("saving inserts the new task first, resets the composer and tracks the creation")
    func savesDraft() async {
        let repository = FakeTaskRepository()
        let analytics = RecordingAnalytics()
        await repository.setPage(Page(items: [TaskItem(id: "old", title: "Old")], nextPageToken: nil), for: nil)
        let model = TaskListViewModel(repository: repository, analytics: analytics)
        await model.refresh()
        model.isComposerPresented = true
        model.draftTitle = "Write tests"
        model.draftPriority = .high

        await model.saveDraft()

        #expect(model.tasks.map(\.id) == ["new", "old"])
        #expect(model.draftTitle.isEmpty)
        #expect(model.draftPriority == .medium)
        #expect(!model.isComposerPresented)
        #expect(!model.isSaving)
        #expect(await repository.createdTitles == ["Write tests"])
        #expect(analytics.events == ["task_created"])
    }

    @Test("apply replaces a row in place and ignores unknown ids; remove drops it")
    func applyAndRemove() async {
        let repository = FakeTaskRepository()
        await repository.setPage(
            Page(items: [TaskItem(id: "1", title: "A"), TaskItem(id: "2", title: "B")], nextPageToken: nil),
            for: nil
        )
        let model = TaskListViewModel(repository: repository)
        await model.refresh()

        model.apply(TaskItem(id: "2", title: "B", status: .done))
        model.apply(TaskItem(id: "missing", title: "X"))
        #expect(model.tasks.map(\.title) == ["A", "B"])
        #expect(model.tasks[1].status == .done)

        model.remove(id: "1")
        #expect(model.tasks.map(\.id) == ["2"])
    }

    @Test("paging starts only from the last row, and refresh starts over from the first page")
    func pagingGuardsAndRefresh() async {
        let repository = FakeTaskRepository()
        await repository.setPage(Page(items: [TaskItem(id: "1", title: "A"), TaskItem(id: "2", title: "B")], nextPageToken: "p2"), for: nil)
        await repository.setPage(Page(items: [TaskItem(id: "3", title: "C")], nextPageToken: nil), for: "p2")
        let model = TaskListViewModel(repository: repository)
        await model.refresh()

        await model.loadMoreIfNeeded(after: model.tasks[0]) // not the last row
        #expect(model.tasks.count == 2)

        await model.loadMoreIfNeeded(after: model.tasks[1])
        #expect(model.tasks.map(\.id) == ["1", "2", "3"])

        await model.refresh()
        #expect(model.tasks.map(\.id) == ["1", "2"])
        #expect(model.hasLoaded)
        #expect(!model.isLoading)
    }
}

@Suite("TaskDetailViewModel")
@MainActor
struct TaskDetailViewModelTests {
    @Test("loading a missing task surfaces .notFound")
    func notFound() async {
        let model = TaskDetailViewModel(taskID: "nope", repository: FakeTaskRepository())

        await model.load()

        #expect(model.error == .notFound)
        #expect(model.task == nil)
    }

    @Test("completing and reopening track their own events and update the model")
    func trackedToggle() async {
        let repository = FakeTaskRepository()
        await repository.setTask(TaskItem(id: "t", title: "Write"))
        let analytics = RecordingAnalytics()
        let callbacks = DetailCallbacks()
        let model = TaskDetailViewModel(
            taskID: "t",
            repository: repository,
            analytics: analytics,
            onChange: { callbacks.changed.append($0) }
        )

        await model.load()
        await model.toggleCompletion()
        #expect(model.task?.status == .done)
        await model.toggleCompletion()
        #expect(model.task?.status == .todo)

        #expect(analytics.events == ["task_completed", "task_reopened"])
        #expect(callbacks.changed.map(\.status) == [.done, .todo])
        #expect(!model.isWorking)
    }

    @Test("toggling before the task is loaded does nothing")
    func toggleWithoutTask() async {
        let analytics = RecordingAnalytics()
        let model = TaskDetailViewModel(taskID: "t", repository: FakeTaskRepository(), analytics: analytics)

        await model.toggleCompletion()

        #expect(analytics.events.isEmpty)
        #expect(model.error == nil)
    }

    @Test("a successful delete reports the id and returns true")
    func deletes() async {
        let repository = FakeTaskRepository()
        await repository.setTask(TaskItem(id: "t", title: "Write"))
        let callbacks = DetailCallbacks()
        let model = TaskDetailViewModel(taskID: "t", repository: repository, onDelete: { callbacks.deleted.append($0) })

        let deleted = await model.delete()

        #expect(deleted)
        #expect(callbacks.deleted == ["t"])
    }
}

@Suite("TaskItem")
struct TaskItemTests {
    private let now = Date(timeIntervalSince1970: 1_000_000)

    @Test("overdue means open and past due; done and undated tasks never are")
    func overdue() {
        let past = now.addingTimeInterval(-60)
        let future = now.addingTimeInterval(60)

        #expect(TaskItem(id: "1", title: "t", dueDate: past).isOverdue(at: now))
        #expect(TaskItem(id: "1", title: "t", status: .inProgress, dueDate: past).isOverdue(at: now))
        #expect(!TaskItem(id: "1", title: "t", status: .done, dueDate: past).isOverdue(at: now))
        #expect(!TaskItem(id: "1", title: "t", dueDate: future).isOverdue(at: now))
        #expect(!TaskItem(id: "1", title: "t").isOverdue(at: now))
    }

    @Test("routes compare by case and payload")
    func routes() {
        #expect(TaskRoute.detail(id: "1") == TaskRoute.detail(id: "1"))
        #expect(TaskRoute.detail(id: "1") != TaskRoute.detail(id: "2"))
        #expect(TaskRoute.list != TaskRoute.detail(id: "1"))
    }
}
