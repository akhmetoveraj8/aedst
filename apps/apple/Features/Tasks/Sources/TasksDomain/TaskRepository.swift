import AedstCore
import Foundation

/// The seam between `Presentation` and `Data` (the `tasks` module's
/// `application` boundary). Every call is scoped to the signed-in user by the
/// server; there is no user id parameter by design (see tasks.proto).
public protocol TaskRepository: Sendable {
    /// One page of the caller's tasks, newest first. `search` is a substring filter.
    func list(search: String, pageToken: String?) async -> Outcome<Page<TaskItem>>
    func get(id: String) async -> Outcome<TaskItem>
    /// `idempotencyKey` is sent as `Idempotency-Key`. Pass the same value the offline queue would use for this
    /// intent (the draft id), so an online attempt that lost its response and the later outbox delivery are one
    /// write for the server.
    func create(_ task: NewTask, idempotencyKey: String?) async -> Outcome<TaskItem>
    func complete(id: String) async -> Outcome<TaskItem>
    func reopen(id: String) async -> Outcome<TaskItem>
    func delete(id: String, idempotencyKey: String?) async -> Outcome<Void>
}

extension TaskRepository {
    /// A create without a caller-chosen key (the server then treats each request as new).
    public func create(_ task: NewTask) async -> Outcome<TaskItem> {
        await create(task, idempotencyKey: nil)
    }

    /// A delete without a caller-chosen key (a repeated delete is naturally idempotent: `notFound` on the second).
    public func delete(id: String) async -> Outcome<Void> {
        await delete(id: id, idempotencyKey: nil)
    }
}
