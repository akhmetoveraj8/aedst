import AedstCore
import Foundation
import GRDB

/// The offline write path as the composition root wires it: one database, the repository features enqueue into,
/// and the coordinator that decides when to drain. Mirrors `core/outbox` on Android (repository + worker +
/// scheduler), with handlers contributed per feature.
public struct AedstOutbox: Sendable {
    /// Where the database lives.
    public enum Storage: Sendable {
        /// `Application Support/AEDST/aedst.sqlite`. Falls back to memory only when the file cannot be used
        /// (cannot open, corrupt, disk full, I/O error); see `memoryFallbackReason`.
        case disk
        /// Unit tests, previews and hermetic UI-test launches.
        case memory
    }

    public let repository: OutboxRepository
    public let coordinator: OutboxSyncCoordinator
    /// The shared database, for features that register their own migrations later.
    public let database: any DatabaseWriter
    /// `nil` normally. When `.disk` was requested but the app is running on an in-memory database, the error that
    /// caused it, so the composition root can report it (queued writes are then lost on exit).
    public let memoryFallbackReason: (any Error)?

    /// Opens the database (all registered migrations applied), builds the drainer over `handlers` and installs
    /// the "work was enqueued" hook that triggers a drain.
    /// - Parameter onRetryScheduled: receives the backoff delay after a retryable failure; on iOS the app uses it
    ///   to submit a `BGAppRefreshTaskRequest` so the drain also happens while the app is suspended.
    /// - Parameter onParked: receives an item type and the error that made the drainer give up on it.
    public init(
        storage: Storage,
        handlers: [any OutboxHandler],
        clock: any AedstClock = SystemClock(),
        onRetryScheduled: @escaping @Sendable (TimeInterval) -> Void = { _ in },
        onParked: @escaping @Sendable (_ type: String, _ error: AedstError) -> Void = { _, _ in }
    ) throws {
        let (database, fallbackReason) = try Self.open(storage)
        let repository = OutboxRepository(database: database, clock: clock)
        let coordinator = OutboxSyncCoordinator(
            drainer: OutboxDrainer(repository: repository, handlers: handlers, onParked: onParked),
            clock: clock,
            onRetryScheduled: onRetryScheduled
        )
        repository.setDidEnqueue { await coordinator.drain() }
        self.repository = repository
        self.coordinator = coordinator
        self.database = database
        self.memoryFallbackReason = fallbackReason
    }

    private static func open(_ storage: Storage) throws -> (any DatabaseWriter, (any Error)?) {
        switch storage {
        case .memory:
            return (try AedstDatabase.openInMemory(), nil)
        case .disk:
            do {
                return (try AedstDatabase.openPool(at: AedstDatabase.defaultURL()), nil)
            } catch {
                // Only a file that cannot be used justifies losing durability. A failing migration is a
                // programming error: stop in DEBUG so it is fixed; in Release keep the app usable.
                if !isStorageFault(error) {
                    assertionFailure("Outbox database migration failed: \(error)")
                }
                AedstLogger(category: "outbox").error("Could not open the on-disk database; using memory", error: error)
                return (try AedstDatabase.openInMemory(), error)
            }
        }
    }

    /// `true` for errors about the file or disk (cannot open, corrupt, not a database, full, I/O, permissions)
    /// and for non-SQLite errors raised while preparing the directory; `false` for SQL/migration errors.
    static func isStorageFault(_ error: any Error) -> Bool {
        guard let databaseError = error as? DatabaseError else { return true }
        let faults: [ResultCode] = [
            .SQLITE_CANTOPEN, .SQLITE_CORRUPT, .SQLITE_NOTADB, .SQLITE_FULL, .SQLITE_IOERR, .SQLITE_READONLY, .SQLITE_PERM,
        ]
        return faults.contains(databaseError.resultCode.primaryResultCode)
    }
}
