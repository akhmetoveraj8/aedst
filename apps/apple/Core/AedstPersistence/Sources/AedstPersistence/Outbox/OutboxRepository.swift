import AedstCore
import Foundation
import GRDB
import os

/// Front door of the offline write path: persist the operation locally, then tell the drainer there is work.
/// Callers update their own local state optimistically and rely on this for delivery (Swift counterpart of
/// `OutboxRepository` in `apps/android/core/outbox`). An actor serializes access; the database serializes writes.
public actor OutboxRepository: OutboxEnqueuing, OutboxFailureReporting {
    private let database: any DatabaseWriter
    private let clock: any AedstClock
    private nonisolated let didEnqueue = OSAllocatedUnfairLock<(@Sendable () async -> Void)?>(initialState: nil)

    public init(database: any DatabaseWriter, clock: any AedstClock = SystemClock()) {
        self.database = database
        self.clock = clock
    }

    /// Installs the "there is work" hook (the composition root points it at `OutboxSyncCoordinator.drain`).
    /// Synchronous so the (non-async) composition root can break the repository <-> coordinator cycle.
    public nonisolated func setDidEnqueue(_ hook: (@Sendable () async -> Void)?) {
        didEnqueue.withLock { $0 = hook }
    }

    public func enqueue(type: String, payload: String, id: String) async throws -> String {
        let createdAt = clock.now
        try await database.write { db in
            // INSERT OR IGNORE: the unique id makes a double tap on the same intent a no-op.
            try db.execute(
                sql: """
                INSERT OR IGNORE INTO aedstOutbox (id, type, payload, status, attempts, createdAt)
                VALUES (?, ?, ?, 'pending', 0, ?)
                """,
                arguments: [id, type, payload, createdAt]
            )
        }
        // Fire and forget: the caller (a save button) must not wait for a network drain.
        if let hook = didEnqueue.withLock({ $0 }) {
            Task { await hook() }
        }
        return id
    }

    /// Operations still waiting for delivery (drives a "syncing..." indicator).
    public func pendingCount() async throws -> Int {
        try await database.read { db in
            try Int.fetchOne(db, sql: "SELECT COUNT(*) FROM aedstOutbox WHERE status = 'pending'") ?? 0
        }
    }

    /// Parked rows (permanent failure or attempts exhausted), in creation order. They are never delivered again
    /// automatically; the UI shows how many there are.
    public func failedEntries() async throws -> [OutboxRecord] {
        try await database.read { db in
            try OutboxRecord.fetchAll(
                db,
                sql: "SELECT * FROM aedstOutbox WHERE status = 'failed' ORDER BY seq"
            )
        }
    }

    /// Number of parked rows of any type.
    public func failedCount() async throws -> Int {
        try await database.read { db in
            try Int.fetchOne(db, sql: "SELECT COUNT(*) FROM aedstOutbox WHERE status = 'failed'") ?? 0
        }
    }

    public func failedCount(types: [String]) async throws -> Int {
        try await failedEntries().filter { types.contains($0.type) }.count
    }

    /// Drops every queued write, parked ones included. Called on sign-out: a row belongs to the user who made it
    /// and must never be delivered under the next user's token.
    public func removeAll() async throws {
        try await database.write { db in
            try db.execute(sql: "DELETE FROM aedstOutbox")
        }
    }

    /// Every row in creation order, parked ones included (diagnostics and tests).
    public func entries() async throws -> [OutboxRecord] {
        try await database.read { db in
            try OutboxRecord.fetchAll(db, sql: "SELECT * FROM aedstOutbox ORDER BY seq")
        }
    }

    // MARK: Drainer operations

    func pending(limit: Int) async throws -> [OutboxRecord] {
        try await database.read { db in
            try OutboxRecord.fetchAll(
                db,
                sql: "SELECT * FROM aedstOutbox WHERE status = 'pending' ORDER BY seq LIMIT ?",
                arguments: [limit]
            )
        }
    }

    func delete(id: String) async throws {
        try await database.write { db in
            try db.execute(sql: "DELETE FROM aedstOutbox WHERE id = ?", arguments: [id])
        }
    }

    func recordAttempt(id: String, error: String) async throws {
        try await database.write { db in
            try db.execute(
                sql: "UPDATE aedstOutbox SET attempts = attempts + 1, lastError = ? WHERE id = ?",
                arguments: [error, id]
            )
        }
    }

    func markFailed(id: String, error: String) async throws {
        try await database.write { db in
            try db.execute(
                sql: "UPDATE aedstOutbox SET status = 'failed', lastError = ? WHERE id = ?",
                arguments: [error, id]
            )
        }
    }
}
