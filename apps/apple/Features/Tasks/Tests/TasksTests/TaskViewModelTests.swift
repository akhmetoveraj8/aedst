import AedstCore
import Foundation
import Testing
@testable import Tasks

/// Scripted repository double.
actor FakeTaskRepository: TaskRepository {
    var pages: [String?: Page<TaskItem>] = [:]
    var stored: [String: TaskItem] = [:]
    private(set) var createdTitles: [String] = []
    /// `Idempotency-Key` of every create call, in order (`nil` when the caller passed none).
    private(set) var createKeys: [String?] = []

    func setPage(_ page: Page<TaskItem>, for token: String?) { pages[token] = page }
    func setTask(_ task: TaskItem) { stored[task.id] = task }

    func list(search: String, pageToken: String?) async -> Outcome<Page<TaskItem>> {
        pages[pageToken].map { .success($0) } ?? .failure(.unavailable(reason: "offline"))
    }

    func get(id: String) async -> Outcome<TaskItem> {
        stored[id].map { .success($0) } ?? .failure(.notFound)
    }

    func create(_ task: NewTask, idempotencyKey: String?) async -> Outcome<TaskItem> {
        createdTitles.append(task.title)
        createKeys.append(idempotencyKey)
        return .success(TaskItem(id: "new", title: task.title, priority: task.priority))
    }

    func complete(id: String) async -> Outcome<TaskItem> {
        guard var task = stored[id] else { return .failure(.notFound) }
        task.status = .done
        stored[id] = task
        return .success(task)
    }

    func reopen(id: String) async -> Outcome<TaskItem> {
        guard var task = stored[id] else { return .failure(.notFound) }
        task.status = .todo
        stored[id] = task
        return .success(task)
    }

    func delete(id: String, idempotencyKey: String?) async -> Outcome<Void> {
        stored[id] = nil
        return .success(())
    }
}

@Suite("Tasks view models")
@MainActor
struct TaskViewModelTests {
    @Test("refresh loads the first page and pagination appends the next one")
    func paginates() async {
        let repository = FakeTaskRepository()
        await repository.setPage(Page(items: [TaskItem(id: "1", title: "A")], nextPageToken: "p2"), for: nil)
        await repository.setPage(Page(items: [TaskItem(id: "2", title: "B")], nextPageToken: nil), for: "p2")
        let model = TaskListViewModel(repository: repository)

        await model.refresh()
        await model.loadMoreIfNeeded(after: model.tasks[0])

        #expect(model.tasks.map(\.id) == ["1", "2"])
        #expect(model.error == nil)
    }

    @Test("a failed load is surfaced as an AedstError")
    func surfacesErrors() async {
        let model = TaskListViewModel(repository: FakeTaskRepository())
        await model.refresh()
        #expect(model.error == .unavailable(reason: "offline"))
    }

    @Test("blank titles are rejected before reaching the server")
    func validatesTitle() async {
        let repository = FakeTaskRepository()
        let result = await CreateTaskUseCase(repository: repository)(NewTask(title: "   "))
        #expect(result.error == .invalidInput(fields: ["title"]))
        #expect(await repository.createdTitles.isEmpty)
    }

    @Test("the create limits are title 1...200 and description 4000 code points, trimmed")
    func createLimits() {
        let tooLongTitle = NewTask(title: String(repeating: "t", count: 201))
        #expect(CreateTaskUseCase.validated(tooLongTitle) == .failure(.title))
        let emoji = String(repeating: "\u{1F600}", count: 200)
        #expect(CreateTaskUseCase.normalized(NewTask(title: emoji))?.title == emoji)
        let tooLongBody = NewTask(title: "ok", details: String(repeating: "d", count: 4001))
        #expect(CreateTaskUseCase.validated(tooLongBody) == .failure(.description))
        let padded = CreateTaskUseCase.normalized(NewTask(title: "  Write \n", details: " body "))
        #expect(padded?.title == "Write")
        #expect(padded?.details == "body")
    }

    @Test("toggleCompletion moves todo → done → todo and reports each change")
    func togglesCompletion() async {
        let repository = FakeTaskRepository()
        await repository.setTask(TaskItem(id: "t", title: "Write"))
        var changes: [TaskItem.Status] = []
        let model = TaskDetailViewModel(taskID: "t", repository: repository, onChange: { changes.append($0.status) })

        await model.load()
        await model.toggleCompletion()
        await model.toggleCompletion()

        #expect(changes == [.done, .todo])
    }
}
