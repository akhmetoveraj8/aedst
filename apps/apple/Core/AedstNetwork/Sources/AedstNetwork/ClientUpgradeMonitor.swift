import os

/// Single-consumer signal "the server refuses this app version". The network layer reports it from one place
/// (`ClientUpgradeInterceptor`, so every request path is covered, including ones whose repository maps errors
/// generically); `RootViewModel` consumes `events` and routes to the blocking upgrade screen.
///
/// The stream is latched to the newest value and never finishes: once the server said "upgrade", repeated
/// reports collapse into one pending event. `hasReported` is the synchronous view of the same fact.
public final class ClientUpgradeMonitor: Sendable {
    public let events: AsyncStream<Void>
    private let continuation: AsyncStream<Void>.Continuation
    private let reported = OSAllocatedUnfairLock(initialState: false)

    public init() {
        let stream = AsyncStream.makeStream(of: Void.self, bufferingPolicy: .bufferingNewest(1))
        self.events = stream.stream
        self.continuation = stream.continuation
    }

    /// `true` once any response carried `CLIENT_UPGRADE_REQUIRED`.
    public var hasReported: Bool { reported.withLock { $0 } }

    public func report() {
        reported.withLock { $0 = true }
        continuation.yield(())
    }
}
