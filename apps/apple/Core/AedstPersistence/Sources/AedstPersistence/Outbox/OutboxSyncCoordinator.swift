import AedstCore
import Foundation

/// Decides *when* the outbox is drained, using only platform signals (no scheduler of our own):
/// - an enqueue (`OutboxRepository` hook),
/// - connectivity coming back (the app forwards `ConnectivityMonitoring` updates to `connectivityChanged`),
/// - the app returning to the foreground (`RootViewModel` calls `drain()`),
/// - `BGTaskScheduler` on iOS (the app delegate calls `drain(force:)` from the registered task and uses
///   `onRetryScheduled` to submit the next request with `earliestBeginDate`).
///
/// After a retryable failure the next in-process run waits an exponential `OutboxBackoff` delay
/// (`AedstClock.sleep`, cancelled by any newer trigger). That delay only matters while the app is alive; when it
/// is suspended the BGTask request is what brings the drainer back.
public actor OutboxSyncCoordinator {
    private let drainer: OutboxDrainer
    private let clock: any AedstClock
    private let backoff: OutboxBackoff
    private let onRetryScheduled: @Sendable (TimeInterval) -> Void
    private var isOnline = true
    private var consecutiveRetries = 0
    private var retryTask: Task<Void, Never>?

    public init(
        drainer: OutboxDrainer,
        clock: any AedstClock = SystemClock(),
        backoff: OutboxBackoff = .default,
        onRetryScheduled: @escaping @Sendable (TimeInterval) -> Void = { _ in }
    ) {
        self.drainer = drainer
        self.clock = clock
        self.backoff = backoff
        self.onRetryScheduled = onRetryScheduled
    }

    /// Feed every reachability update here. Coming online drains; going offline only records the state.
    public func connectivityChanged(isOnline: Bool) async {
        self.isOnline = isOnline
        if isOnline { await drain() }
    }

    /// One drain attempt. Skipped while offline unless `force` (a BGTask runs with the network the system
    /// granted, whatever the last observed state was).
    @discardableResult
    public func drain(force: Bool = false) async -> OutboxRunResult? {
        guard isOnline || force else { return nil }
        retryTask?.cancel()
        retryTask = nil
        let result = await drainer.run()
        switch result {
        case .complete, .blocked:
            consecutiveRetries = 0
        case .retry:
            consecutiveRetries += 1
            scheduleRetry(after: backoff.delay(afterFailures: consecutiveRetries))
        }
        return result
    }

    private func scheduleRetry(after delay: TimeInterval) {
        onRetryScheduled(delay)
        let clock = self.clock
        retryTask = Task { [weak self] in
            do {
                try await clock.sleep(for: delay)
            } catch {
                return
            }
            await self?.retryDidFire()
        }
    }

    /// Detaches the finished timer first so `drain` cancels only a *newer* one, never the task that is running it
    /// (cancelling it would abort the handlers' network calls).
    private func retryDidFire() async {
        retryTask = nil
        await drain()
    }
}
