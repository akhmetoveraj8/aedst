import AedstCore
import AedstTesting
import Foundation
import Testing
@testable import AedstPersistence

/// Replays `docs/contract/behavior/offline-outbox.json` (the cross-platform source of truth, loaded from the
/// repository, not copied) against the real GRDB outbox and drainer.
private struct OutboxFixture: Decodable {
    struct Case: Decodable {
        let id: String
        let steps: [Step]
    }

    struct Step: Decodable {
        struct Enqueue: Decodable {
            let id: String
            let type: String
        }

        struct Run: Decodable {
            let outcomes: [String]
        }

        struct Sent: Decodable, Equatable {
            let id: String
            let idempotencyKey: String
        }

        struct QueueEntry: Decodable, Equatable {
            let id: String
            let status: String
            let attempts: Int
        }

        struct Expect: Decodable {
            let result: String?
            let sent: [Sent]?
            let queue: [QueueEntry]?
        }

        let enqueue: Enqueue?
        let run: Run?
        let repeatRun: Int?
        let expect: Expect?
    }

    let maxAttempts: Int
    let knownTypes: [String]
    let cases: [Case]
}

@Suite("offline-outbox behaviour fixture")
struct OfflineOutboxReplayTests {
    @Test("the drainer's attempt limit is the fixture's")
    func maxAttemptsMatches() throws {
        let fixture = try BehaviorFixture.load(OutboxFixture.self, named: "offline-outbox")
        #expect(OutboxDrainer.maxAttempts == fixture.maxAttempts)
    }

    @Test("every case in the fixture behaves as written")
    func replaysEveryCase() async throws {
        let fixture = try BehaviorFixture.load(OutboxFixture.self, named: "offline-outbox")
        #expect(!fixture.cases.isEmpty)
        for fixtureCase in fixture.cases {
            try await replay(fixtureCase, knownTypes: fixture.knownTypes)
        }
    }

    private func replay(_ fixtureCase: OutboxFixture.Case, knownTypes: [String]) async throws {
        let rig = try OutboxRig(types: knownTypes)
        for step in fixtureCase.steps {
            if let enqueue = step.enqueue {
                _ = try await rig.repository.enqueue(type: enqueue.type, payload: "{}", id: enqueue.id)
            }
            guard let run = step.run else { continue }
            let times = step.repeatRun ?? 1
            for iteration in 0..<times {
                await rig.script.load(run.outcomes)
                let result = await rig.drainer.run()
                // The reference model checks every iteration of a repeatRun, otherwise the single run.
                guard step.repeatRun != nil || iteration == times - 1, let expect = step.expect else { continue }
                try await check(expect, result: result, rig: rig, caseID: fixtureCase.id)
            }
        }
    }

    private func check(
        _ expect: OutboxFixture.Step.Expect,
        result: OutboxRunResult,
        rig: OutboxRig,
        caseID: String
    ) async throws {
        if let expected = expect.result {
            #expect(Self.name(of: result) == expected, "\(caseID): run result")
        }
        if let expected = expect.sent {
            let sent = await rig.script.sent.map { OutboxFixture.Step.Sent(id: $0.id, idempotencyKey: $0.idempotencyKey) }
            #expect(sent == expected, "\(caseID): deliveries")
        }
        if let expected = expect.queue {
            let queue = try await rig.queue().map {
                OutboxFixture.Step.QueueEntry(id: $0.id, status: $0.status, attempts: $0.attempts)
            }
            #expect(queue == expected, "\(caseID): queue")
        }
    }

    private static func name(of result: OutboxRunResult) -> String {
        switch result {
        case .complete: "complete"
        case .retry: "retry"
        case .blocked: "blocked"
        }
    }
}
