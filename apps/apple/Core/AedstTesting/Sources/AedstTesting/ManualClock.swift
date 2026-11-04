import AedstCore
import Foundation

/// `AedstClock` test double: `sleep(for:)` returns immediately (recording
/// the requested duration) instead of really waiting, and `now` is set by
/// the test instead of tracking the wall clock. Used to unit-test retry
/// backoff and token-expiry logic without real delays.
public final class ManualClock: AedstClock, @unchecked Sendable {
    private let lock = NSLock()
    private var _now: Date
    public private(set) var sleptDurations: [TimeInterval] = []

    public init(now: Date = Date(timeIntervalSince1970: 0)) {
        self._now = now
    }

    public var now: Date {
        lock.withLock { _now }
    }

    public func advance(by interval: TimeInterval) {
        lock.withLock { _now = _now.addingTimeInterval(interval) }
    }

    public func sleep(for duration: TimeInterval) async throws {
        lock.withLock { sleptDurations.append(duration) }
    }
}
