import AedstCore
import Foundation

/// Queues Tasks writes for offline-tolerant delivery. The matching handlers (`TaskOutboxHandlers`) deliver them
/// with the row id as `Idempotency-Key`. Features depend on `OutboxEnqueuing` (AedstCore), never on the
/// database module.
public struct TaskOutboxQueue: Sendable {
    /// Outbox `type` of a queued create; also the key the handler is registered under.
    public static let createType = "task.create"
    /// Outbox `type` of a queued partial update.
    public static let updateType = "task.update"

    private let outbox: any OutboxEnqueuing
    private let failures: (any OutboxFailureReporting)?

    /// `failures` (the same repository, in production) enables `failedCount()`.
    public init(outbox: any OutboxEnqueuing, failures: (any OutboxFailureReporting)? = nil) {
        self.outbox = outbox
        self.failures = failures
    }

    /// Queued Tasks writes the drainer gave up on (permanent failure or attempts exhausted); `0` when unknown.
    public func failedCount() async -> Int {
        guard let failures else { return 0 }
        return (try? await failures.failedCount(types: [Self.createType, Self.updateType])) ?? 0
    }

    /// Queues a create (the title must already be validated, see `CreateTaskUseCase.normalized`). Pass a stable
    /// `id` per user intent so a double tap does not create two tasks. Returns the operation id.
    public func enqueueCreate(_ task: NewTask, id: String = UUID().uuidString) async -> Outcome<String> {
        await enqueue(type: Self.createType, id: id) { try TaskOutboxPayload.encode(TaskOutboxPayload.Create(task)) }
    }

    /// Queues a partial update of an existing task.
    public func enqueueUpdate(_ update: TaskUpdate, id: String = UUID().uuidString) async -> Outcome<String> {
        await enqueue(type: Self.updateType, id: id) { try TaskOutboxPayload.encode(TaskOutboxPayload.Update(update)) }
    }

    private func enqueue(type: String, id: String, payload: () throws -> String) async -> Outcome<String> {
        do {
            let json = try payload()
            return .success(try await outbox.enqueue(type: type, payload: json, id: id))
        } catch {
            return .failure(.storage(reason: String(describing: error)))
        }
    }
}
