import AedstCore
import AedstTesting
import Foundation
import GRDB
@testable import AedstPersistence

/// Records every delivery attempt and answers from a script of `ok` / `retryable` / `permanent` outcomes.
actor OutboxScript {
    struct Sent: Equatable {
        let id: String
        let idempotencyKey: String
    }

    private var outcomes: [String] = []
    private(set) var sent: [Sent] = []

    /// Replaces the script and clears the delivery log.
    func load(_ outcomes: [String]) {
        self.outcomes = outcomes
        sent = []
    }

    func next(for item: OutboxItem) -> Outcome<Void> {
        // The item id is the Idempotency-Key: the production handlers pass `item.id` to `IdempotencyKey`.
        sent.append(Sent(id: item.id, idempotencyKey: item.id))
        guard !outcomes.isEmpty else { return .failure(.unknown(reason: "no scripted outcome")) }
        switch outcomes.removeFirst() {
        case "ok": return .success(())
        case "retryable": return .failure(.unavailable(reason: "scripted"))
        case "upgrade": return .failure(.upgradeRequired)
        default: return .failure(.invalidInput(fields: ["scripted"]))
        }
    }
}

struct ScriptedHandler: OutboxHandler {
    let type: String
    let script: OutboxScript

    func deliver(_ item: OutboxItem) async -> Outcome<Void> {
        await script.next(for: item)
    }
}

/// A repository over a fresh in-memory database, a drainer wired to `script`, and the script.
struct OutboxRig {
    let repository: OutboxRepository
    let drainer: OutboxDrainer
    let script: OutboxScript

    init(types: [String], clock: any AedstClock = ManualClock()) throws {
        let queue = try AedstDatabase.openInMemory()
        let script = OutboxScript()
        let repository = OutboxRepository(database: queue, clock: clock)
        self.repository = repository
        self.script = script
        self.drainer = OutboxDrainer(
            repository: repository,
            handlers: types.map { ScriptedHandler(type: $0, script: script) }
        )
    }

    /// `(id, status, attempts)` of every row in creation order.
    func queue() async throws -> [OutboxQueueEntry] {
        try await repository.entries().map { OutboxQueueEntry(id: $0.id, status: $0.status, attempts: $0.attempts) }
    }
}

struct OutboxQueueEntry: Equatable {
    let id: String
    let status: String
    let attempts: Int
}
