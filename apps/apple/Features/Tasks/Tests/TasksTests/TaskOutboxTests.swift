import AedstCore
import Foundation
import Testing
@testable import Tasks

/// Records what a feature enqueues; ignores a repeated id like the real outbox.
actor RecordingOutbox: OutboxEnqueuing {
    struct Entry: Equatable {
        let type: String
        let payload: String
        let id: String
    }

    private(set) var entries: [Entry] = []
    var failure: Error?

    func setFailure(_ error: Error?) { failure = error }

    func enqueue(type: String, payload: String, id: String) async throws -> String {
        if let failure { throw failure }
        if !entries.contains(where: { $0.id == id }) {
            entries.append(Entry(type: type, payload: payload, id: id))
        }
        return id
    }
}

/// Every call fails as if the device were offline.
struct OfflineTaskRepository: TaskRepository {
    func list(search: String, pageToken: String?) async -> Outcome<Page<TaskItem>> { .failure(.unavailable(reason: "offline")) }
    func get(id: String) async -> Outcome<TaskItem> { .failure(.unavailable(reason: "offline")) }
    func create(_ task: NewTask, idempotencyKey: String?) async -> Outcome<TaskItem> { .failure(.unavailable(reason: "offline")) }
    func complete(id: String) async -> Outcome<TaskItem> { .failure(.unavailable(reason: "offline")) }
    func reopen(id: String) async -> Outcome<TaskItem> { .failure(.unavailable(reason: "offline")) }
    func delete(id: String, idempotencyKey: String?) async -> Outcome<Void> { .failure(.unavailable(reason: "offline")) }
}

@Suite("Tasks outbox")
struct TaskOutboxTests {
    @Test("a create is queued under task.create with a payload that round-trips")
    func createPayload() async throws {
        let outbox = RecordingOutbox()
        let due = Date(timeIntervalSince1970: 1_800_000_000)
        let task = NewTask(title: "Pay rent", details: "June", priority: .high, dueDate: due)

        let id = try #require(await TaskOutboxQueue(outbox: outbox).enqueueCreate(task, id: "intent-1").value)

        #expect(id == "intent-1")
        let entry = try #require(await outbox.entries.first)
        #expect(entry.type == "task.create")
        let decoded = try #require(TaskOutboxPayload.decode(TaskOutboxPayload.Create.self, from: entry.payload))
        #expect(decoded == TaskOutboxPayload.Create(task))
        #expect(decoded.priority == "high")
        #expect(decoded.dueDate == due)
    }

    @Test("an update carries only the fields that were set")
    func updatePayload() async throws {
        let outbox = RecordingOutbox()
        let update = TaskUpdate(id: "t1", title: "New title", priority: .low, expectedVersion: 3)

        _ = await TaskOutboxQueue(outbox: outbox).enqueueUpdate(update, id: "u1")

        let entry = try #require(await outbox.entries.first)
        #expect(entry.type == "task.update")
        let decoded = try #require(TaskOutboxPayload.decode(TaskOutboxPayload.Update.self, from: entry.payload))
        #expect(decoded.id == "t1")
        #expect(decoded.title == "New title")
        #expect(decoded.details == nil)
        #expect(decoded.priority == "low")
        #expect(decoded.expectedVersion == 3)
    }

    @Test("the same intent id enqueued twice is stored once")
    func duplicateIntent() async {
        let outbox = RecordingOutbox()
        let queue = TaskOutboxQueue(outbox: outbox)
        _ = await queue.enqueueCreate(NewTask(title: "A"), id: "same")
        _ = await queue.enqueueCreate(NewTask(title: "A"), id: "same")
        #expect(await outbox.entries.count == 1)
    }

    @Test("a storage failure is reported as an AedstError, not thrown")
    func storageFailure() async {
        struct Boom: Error {}
        let outbox = RecordingOutbox()
        await outbox.setFailure(Boom())
        let result = await TaskOutboxQueue(outbox: outbox).enqueueCreate(NewTask(title: "A"))
        if case .failure(.storage) = result {
            // expected
        } else {
            Issue.record("expected .storage")
        }
    }

    @Test("priority wire names are stable and round-trip")
    func wireNames() {
        #expect(TaskItem.Priority.allCases.map(\.wireName) == ["low", "medium", "high", "urgent"])
        for priority in TaskItem.Priority.allCases {
            #expect(TaskItem.Priority(wireName: priority.wireName) == priority)
        }
        #expect(TaskItem.Priority(wireName: "nope") == nil)
    }

    @MainActor
    @Test("offline create is queued, shown as pending and not reported as an error")
    func offlineCreateIsQueued() async {
        let outbox = RecordingOutbox()
        let model = TaskListViewModel(repository: OfflineTaskRepository(), outbox: TaskOutboxQueue(outbox: outbox))
        model.draftTitle = "  Buy milk  "

        await model.saveDraft()

        #expect(model.error == nil)
        #expect(model.tasks.map(\.title) == ["Buy milk"])
        #expect(model.pendingIDs == Set(model.tasks.map(\.id)))
        #expect(model.draftTitle.isEmpty)
        #expect(await outbox.entries.count == 1)
    }

    @MainActor
    @Test("a validation failure is never queued")
    func invalidTitleNotQueued() async {
        let outbox = RecordingOutbox()
        let model = TaskListViewModel(repository: OfflineTaskRepository(), outbox: TaskOutboxQueue(outbox: outbox))
        model.draftTitle = String(repeating: "x", count: CreateTaskUseCase.maxTitleLength + 1)

        await model.saveDraft()

        #expect(model.error == .invalidInput(fields: ["title"]))
        #expect(await outbox.entries.isEmpty)
    }

    @MainActor
    @Test("without an outbox an offline create still surfaces the error")
    func noOutboxKeepsError() async {
        let model = TaskListViewModel(repository: OfflineTaskRepository())
        model.draftTitle = "A"

        await model.saveDraft()

        #expect(model.error == .unavailable(reason: "offline"))
        #expect(model.tasks.isEmpty)
    }
}
