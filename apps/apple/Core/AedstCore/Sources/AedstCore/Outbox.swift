import Foundation

/// A queued write as handed to its `OutboxHandler`. Mirrors `OutboxItem` in
/// `apps/android/core/outbox`.
public struct OutboxItem: Sendable, Equatable {
    /// Stable id of the user intent; also the `Idempotency-Key` of every delivery attempt.
    public let id: String
    /// Selects the handler (`task.create`, `task.update`, ...).
    public let type: String
    /// Opaque, handler-owned JSON text. Never put secrets or PII in it: the database is not encrypted.
    public let payload: String
    /// Failed delivery attempts so far.
    public let attempts: Int

    public init(id: String, type: String, payload: String, attempts: Int) {
        self.id = id
        self.type = type
        self.payload = payload
        self.attempts = attempts
    }
}

/// Delivers one kind of queued write. Each feature contributes its handlers to the composition root
/// (`AppDependencies`); the drainer looks them up by `type`.
///
/// Contract (same as Android, ADR-0013):
/// - Delivery is **at-least-once**: send `OutboxItem.id` as the `Idempotency-Key` header so a retry after a lost
///   response cannot apply the write twice (`IdempotencyKey.header(for:)` in `AedstNetwork`).
/// - Return `.failure` with a retryable error (`.unavailable`, `.rateLimited`) to have the item retried later with
///   backoff; any other error is permanent and the item is parked as `failed`.
/// - Never throw for expected failures.
public protocol OutboxHandler: Sendable {
    /// Matches `OutboxItem.type`; unique across handlers.
    var type: String { get }

    func deliver(_ item: OutboxItem) async -> Outcome<Void>
}

/// The front door of the offline write path, as seen by features. Implemented by `OutboxRepository` in
/// `AedstPersistence`; features depend only on this protocol so they never import the database module.
public protocol OutboxEnqueuing: Sendable {
    /// Persists the write and asks the drainer to run. Pass a stable `id` when the same user intent could be
    /// enqueued twice (a double tap): a second insert with the same id is ignored. Returns the operation id.
    func enqueue(type: String, payload: String, id: String) async throws -> String
}

extension OutboxEnqueuing {
    /// Enqueues under a fresh id (use when a double tap cannot produce the same intent twice).
    @discardableResult
    public func enqueue(type: String, payload: String) async throws -> String {
        try await enqueue(type: type, payload: payload, id: UUID().uuidString)
    }
}

/// Read side of parked (permanently failed) outbox rows, so a screen can say "N changes were not synced".
/// Implemented by `OutboxRepository`; features depend on this protocol only.
public protocol OutboxFailureReporting: Sendable {
    /// Number of parked rows whose `type` is in `types`.
    func failedCount(types: [String]) async throws -> Int
}
