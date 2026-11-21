import Foundation

/// Lets a refresh run at most once per `interval`. The caller supplies the time (from `AedstClock`), so the
/// policy is deterministic in tests.
struct ForegroundRefreshThrottle {
    let interval: TimeInterval
    private var lastRun: Date?

    init(interval: TimeInterval = 60) {
        self.interval = interval
    }

    /// `true` (and the run is recorded) when nothing ran in the last `interval` seconds.
    mutating func shouldRun(at now: Date) -> Bool {
        if let lastRun, now.timeIntervalSince(lastRun) < interval { return false }
        lastRun = now
        return true
    }

    /// Records a run that happened outside `shouldRun` (the launch refresh).
    mutating func markRun(at now: Date) {
        lastRun = now
    }
}
