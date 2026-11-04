import AedstCore
import AedstTesting
import Foundation
import GRDB
import Testing
@testable import AedstPersistence

@Suite("Outbox")
struct OutboxTests {
    private let types = ["task.create", "task.update"]

    @Test("the base migration creates the outbox table")
    func migrationCreatesTable() async throws {
        let queue = try AedstDatabase.openInMemory()
        let exists = try await queue.read { db in try db.tableExists(OutboxRecord.databaseTableName) }
        #expect(exists)
    }

    @Test("enqueue stores a pending row and a duplicate id is ignored, keeping the first payload")
    func duplicateEnqueueIgnored() async throws {
        let rig = try OutboxRig(types: types)

        _ = try await rig.repository.enqueue(type: "task.create", payload: "{\"title\":\"first\"}", id: "a")
        _ = try await rig.repository.enqueue(type: "task.create", payload: "{\"title\":\"second\"}", id: "a")

        let entries = try await rig.repository.entries()
        #expect(entries.count == 1)
        #expect(entries.first?.payload == "{\"title\":\"first\"}")
        #expect(entries.first?.status == OutboxRecord.pendingStatus)
        #expect(try await rig.repository.pendingCount() == 1)
    }

    @Test("enqueue without an id generates a unique one")
    func generatedIDs() async throws {
        let rig = try OutboxRig(types: types)
        let first = try await rig.repository.enqueue(type: "task.create", payload: "{}")
        let second = try await rig.repository.enqueue(type: "task.create", payload: "{}")
        #expect(first != second)
        #expect(try await rig.repository.entries().count == 2)
    }

    @Test("enqueue calls the did-enqueue hook")
    func hookIsCalled() async throws {
        let rig = try OutboxRig(types: types)
        let counter = HookCounter()
        rig.repository.setDidEnqueue { await counter.increment() }

        _ = try await rig.repository.enqueue(type: "task.create", payload: "{}", id: "a")

        var polls = 0
        while await counter.value == 0, polls < 200 {
            polls += 1
            try await Task.sleep(nanoseconds: 10_000_000)
        }
        #expect(await counter.value == 1)
    }

    @Test("rows are returned in creation order even when ids sort differently")
    func fifoBySequence() async throws {
        let rig = try OutboxRig(types: types)
        for id in ["z", "m", "a"] {
            _ = try await rig.repository.enqueue(type: "task.create", payload: "{}", id: id)
        }
        await rig.script.load(["ok", "ok", "ok"])

        _ = await rig.drainer.run()

        #expect(await rig.script.sent.map(\.id) == ["z", "m", "a"])
    }

    @Test("an upgrade-required answer stops the run without parking or counting an attempt")
    func upgradeRequiredBlocks() async throws {
        let rig = try OutboxRig(types: types)
        _ = try await rig.repository.enqueue(type: "task.create", payload: "{}", id: "a")
        await rig.script.load(["upgrade"])

        let result = await rig.drainer.run()

        #expect(result == .blocked)
        #expect(try await rig.queue() == [OutboxQueueEntry(id: "a", status: "pending", attempts: 0)])
    }

    @Test("an enqueue that races a running drain is still delivered")
    func enqueueDuringRun() async throws {
        let rig = try OutboxRig(types: types)
        _ = try await rig.repository.enqueue(type: "task.create", payload: "{}", id: "a")
        await rig.script.load(["ok", "ok"])

        async let first = rig.drainer.run()
        _ = try await rig.repository.enqueue(type: "task.update", payload: "{}", id: "b")
        async let second = rig.drainer.run()
        _ = await (first, second)

        // Whichever run saw "b", it must not be left behind.
        #expect(try await rig.repository.pendingCount() == 0)
    }

    @Test("the wired outbox drains by itself after an enqueue")
    func endToEnd() async throws {
        let script = OutboxScript()
        await script.load(["ok"])
        let outbox = try AedstOutbox(storage: .memory, handlers: [ScriptedHandler(type: "task.create", script: script)])

        _ = try await outbox.repository.enqueue(type: "task.create", payload: "{}", id: "a")
        var polls = 0
        while try await outbox.repository.pendingCount() > 0, polls < 200 {
            polls += 1
            try await Task.sleep(nanoseconds: 10_000_000)
        }

        #expect(try await outbox.repository.entries().isEmpty)
        #expect(await script.sent.map(.idempotencyKey) == ["a"])
    }

    @Test("removeAll drops every row, so a signed-out user's writes are never delivered to the next one")
    func removeAllDropsEverything() async throws {
        let rig = try OutboxRig(types: types)
        _ = try await rig.repository.enqueue(type: "task.create", payload: "{}", id: "a")
        _ = try await rig.repository.enqueue(type: "task.update", payload: "{}", id: "b")

        try await rig.repository.removeAll()

        #expect(try await rig.repository.entries().isEmpty)
    }

    @Test("backoff doubles from the base and is capped")
    func backoffSchedule() {
        let backoff = OutboxBackoff(base: 30, cap: 900)
        #expect(backoff.delay(afterFailures: 1) == 30)
        #expect(backoff.delay(afterFailures: 2) == 60)
        #expect(backoff.delay(afterFailures: 3) == 120)
        #expect(backoff.delay(afterFailures: 6) == 900)
        #expect(backoff.delay(afterFailures: 500) == 900)
        #expect(backoff.delay(afterFailures: 0) == 30)
    }
}

actor HookCounter {
    private(set) var value = 0
    func increment() { value += 1 }
}
