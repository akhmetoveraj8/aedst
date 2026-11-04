import AedstCore
import Foundation

/// How one drain run ended.
public enum OutboxRunResult: Sendable, Equatable {
    /// Nothing pending is left that a run can progress (parked items do not count).
    case complete
    /// A retryable failure stopped the run; schedule another run with backoff.
    case retry
    /// The server refuses this app version (`CLIENT_UPGRADE_REQUIRED`): nothing was parked or counted, and
    /// retrying is pointless until the app is updated.
    case blocked
}

/// Drains the outbox in creation order (Swift counterpart of `OutboxSyncWorker` on Android).
///
/// Ordering matters (create then edit), so a retryable failure stops the run instead of skipping ahead; a
/// permanent failure, an unknown type or the 8th failed attempt parks just that item and the run continues.
/// Rules are pinned by `docs/contract/behavior/offline-outbox.json`.
public actor OutboxDrainer {
    /// Attempts after which a still-retryable item is parked (`maxAttempts` in the fixture).
    public static let maxAttempts = 8
    private static let batchSize = 50

    private let repository: OutboxRepository
    private let handlers: [String: any OutboxHandler]
    private let logger = AedstLogger(category: "outbox")
    private var isRunning = false
    private var rerunRequested = false
    private let onParked: @Sendable (_ type: String, _ error: AedstError) -> Void

    /// `onParked` is told about every item the drainer gives up on (permanent failure or attempts exhausted), so the
    /// app can report it; the payload is never passed on.
    public init(
        repository: OutboxRepository,
        handlers: [any OutboxHandler],
        onParked: @escaping @Sendable (_ type: String, _ error: AedstError) -> Void = { _, _ in }
    ) {
        self.onParked = onParked
        self.repository = repository
        // A later handler for the same type replaces an earlier one; types are meant to be unique.
        self.handlers = Dictionary(handlers.map { ($0.type, $0) }, uniquingKeysWith: { _, last in last })
    }

    /// Runs until the queue is drained or a run-stopping outcome happens. A call that arrives while a run is in
    /// flight returns `.complete` at once and makes the running drain take another pass, so an item enqueued
    /// mid-run is never missed (the equivalent of WorkManager's `APPEND_OR_REPLACE`).
    public func run() async -> OutboxRunResult {
        if isRunning {
            rerunRequested = true
            return .complete
        }
        isRunning = true
        defer { isRunning = false }
        repeat {
            rerunRequested = false
            let result = await drainOnce()
            if result != .complete { return result }
        } while rerunRequested
        return .complete
    }

    private func drainOnce() async -> OutboxRunResult {
        while true {
            let batch: [OutboxRecord]
            do {
                batch = try await repository.pending(limit: Self.batchSize)
            } catch {
                logger.error("Could not read the outbox", error: error)
                return .retry
            }
            if batch.isEmpty { return .complete }
            for row in batch {
                switch await deliver(row) {
                case .complete: continue
                case let stop: return stop
                }
            }
        }
    }

    /// `.complete` means "carry on with the next item".
    private func deliver(_ row: OutboxRecord) async -> OutboxRunResult {
        do {
            guard let handler = handlers[row.type] else {
                logger.error("No OutboxHandler registered for type \(row.type); parking item")
                try await repository.markFailed(id: row.id, error: "NoHandler")
                onParked(row.type, .unsupported)
                return .complete
            }
            let item = OutboxItem(id: row.id, type: row.type, payload: row.payload, attempts: row.attempts)
            switch await handler.deliver(item) {
            case .success:
                try await repository.delete(id: row.id)
                return .complete
            case .failure(let error):
                return try await onFailure(row, error)
            }
        } catch {
            // The queue itself is unreadable/unwritable: stop and let the next trigger try again.
            logger.error("Outbox storage failed while delivering", error: error)
            return .retry
        }
    }

    private func onFailure(_ row: OutboxRecord, _ error: AedstError) async throws -> OutboxRunResult {
        let kind = error.analyticsCategory
        if error == .upgradeRequired { return .blocked }
        if error.isRetryable, row.attempts + 1 < Self.maxAttempts {
            try await repository.recordAttempt(id: row.id, error: kind)
            return .retry
        }
        logger.error("Giving up on outbox item \(row.type) after \(row.attempts + 1) attempt(s): \(kind)")
        try await repository.markFailed(id: row.id, error: kind)
        onParked(row.type, error)
        return .complete
    }
}
