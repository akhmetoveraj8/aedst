import AedstCore
import AedstTesting
import Foundation
import Testing
@testable import AedstPersistence

@Suite("OutboxSyncCoordinator")
struct OutboxSyncCoordinatorTests {
    private func makeCoordinator(
        _ rig: OutboxRig,
        onRetryScheduled: @escaping @Sendable (TimeInterval) -> Void = { _ in }
    ) -> OutboxSyncCoordinator {
        OutboxSyncCoordinator(
            drainer: rig.drainer,
            clock: ManualClock(),
            onRetryScheduled: onRetryScheduled
        )
    }

    @Test("coming online drains the queue; being offline does not")
    func drainsWhenOnline() async throws {
        let rig = try OutboxRig(types: ["task.create"])
        _ = try await rig.repository.enqueue(type: "task.create", payload: "{}", id: "a")
        await rig.script.load(["ok"])
        let coordinator = makeCoordinator(rig)

        await coordinator.connectivityChanged(isOnline: false)
        #expect(try await rig.repository.pendingCount() == 1)

        await coordinator.connectivityChanged(isOnline: true)
        #expect(try await rig.repository.pendingCount() == 0)
    }

    @Test("a drain request while offline is skipped unless forced (background task)")
    func offlineDrainSkipped() async throws {
        let rig = try OutboxRig(types: ["task.create"])
        _ = try await rig.repository.enqueue(type: "task.create", payload: "{}", id: "a")
        await rig.script.load(["ok"])
        let coordinator = makeCoordinator(rig)
        await coordinator.connectivityChanged(isOnline: false)

        #expect(await coordinator.drain() == nil)
        #expect(try await rig.repository.pendingCount() == 1)
        #expect(await coordinator.drain(force: true) == .complete)
        #expect(try await rig.repository.pendingCount() == 0)
    }

    @Test("a retryable failure reports the backoff delay and the retry then delivers")
    func retryAfterBackoff() async throws {
        let rig = try OutboxRig(types: ["task.create"])
        _ = try await rig.repository.enqueue(type: "task.create", payload: "{}", id: "a")
        await rig.script.load(["retryable", "ok"])
        let delays = DelayLog()
        let coordinator = makeCoordinator(rig) { delay in delays.record(delay) }

        #expect(await coordinator.drain() == .retry)
        // ManualClock.sleep returns at once, so the scheduled retry runs right away.
        var attempts = 0
        while try await rig.repository.pendingCount() > 0, attempts < 200 {
            attempts += 1
            try await Task.sleep(nanoseconds: 10_000_000)
        }

        #expect(try await rig.repository.pendingCount() == 0)
        #expect(delays.values == [30])
    }
}

private final class DelayLog: @unchecked Sendable {
    private let lock = NSLock()
    private var storage: [TimeInterval] = []

    var values: [TimeInterval] { lock.withLock { storage } }

    func record(_ value: TimeInterval) { lock.withLock { storage.append(value) } }
}
