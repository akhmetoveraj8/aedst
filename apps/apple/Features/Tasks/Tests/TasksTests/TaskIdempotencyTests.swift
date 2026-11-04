import AedstCore
import Foundation
import Testing
@testable import Tasks

/// Offline repository that remembers the key of each create attempt.
actor KeyRecordingOfflineRepository: TaskRepository {
    private(set) var createKeys: [String?] = []

    func list(search: String, pageToken: String?) async -> Outcome<Page<TaskItem>> { .failure(.unavailable(reason: "offline")) }
    func get(id: String) async -> Outcome<TaskItem> { .failure(.unavailable(reason: "offline")) }
    func create(_ task: NewTask, idempotencyKey: String?) async -> Outcome<TaskItem> {
        createKeys.append(idempotencyKey)
        return .failure(.unavailable(reason: "offline"))
    }
    func complete(id: String) async -> Outcome<TaskItem> { .failure(.unavailable(reason: "offline")) }
    func reopen(id: String) async -> Outcome<TaskItem> { .failure(.unavailable(reason: "offline")) }
    func delete(id: String, idempotencyKey: String?) async -> Outcome<Void> { .failure(.unavailable(reason: "offline")) }
}

struct StubFailureReporter: OutboxFailureReporting {
    let failed: [String: Int]

    func failedCount(types: [String]) async throws -> Int {
        types.reduce(0) { $0 + (failed[$1] ?? 0) }
    }
}

@Suite("Tasks idempotency and unsynced writes")
@MainActor
struct TaskIdempotencyTests {
    @Test("an online create sends the draft id as Idempotency-Key and a new intent gets a new key")
    func onlineCreateUsesDraftID() async {
        let repository = FakeTaskRepository()
        let model = TaskListViewModel(repository: repository)

        model.draftTitle = "First"
        await model.saveDraft()
        model.draftTitle = "Second"
        await model.saveDraft()

        let keys = await repository.createKeys
        #expect(keys.count == 2)
        #expect(keys[0] != nil)
        #expect(keys[0] != keys[1])
    }

    @Test("the online attempt and the queued write of one intent share one key")
    func onlineAndOutboxShareKey() async throws {
        let repository = KeyRecordingOfflineRepository()
        let outbox = RecordingOutbox()
        let model = TaskListViewModel(repository: repository, outbox: TaskOutboxQueue(outbox: outbox))
        model.draftTitle = "Buy milk"

        await model.saveDraft()

        let onlineKey = try #require(await repository.createKeys.first ?? nil)
        let queued = try #require(await outbox.entries.first)
        #expect(queued.id == onlineKey)
    }

    @Test("the unsynced count comes from the parked Tasks rows only")
    func unsyncedCount() async {
        let queue = TaskOutboxQueue(
            outbox: RecordingOutbox(),
            failures: StubFailureReporter(failed: ["task.create": 2, "task.update": 1, "other.type": 5])
        )
        let repository = FakeTaskRepository()
        await repository.setPage(Page(items: [], nextPageToken: nil), for: nil)
        let model = TaskListViewModel(repository: repository, outbox: queue)

        await model.refresh()

        #expect(model.unsyncedCount == 3)
    }

    @Test("without a failure reporter the count is zero")
    func noReporter() async {
        let model = TaskListViewModel(repository: FakeTaskRepository(), outbox: TaskOutboxQueue(outbox: RecordingOutbox()))
        await model.refreshUnsyncedCount()
        #expect(model.unsyncedCount == 0)
    }
}
