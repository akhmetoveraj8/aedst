import Foundation
import Testing
@testable import AedstAppShared

@Suite("ForegroundRefreshThrottle")
struct ForegroundRefreshThrottleTests {
    private let start = Date(timeIntervalSince1970: 1_000_000)

    @Test("the first foreground runs, a second one inside the interval does not")
    func throttles() {
        var throttle = ForegroundRefreshThrottle(interval: 60)
        #expect(throttle.shouldRun(at: start))
        #expect(!throttle.shouldRun(at: start.addingTimeInterval(59)))
    }

    @Test("it runs again once the interval has passed, and counts from the last run")
    func runsAgain() {
        var throttle = ForegroundRefreshThrottle(interval: 60)
        #expect(throttle.shouldRun(at: start))
        #expect(throttle.shouldRun(at: start.addingTimeInterval(60)))
        #expect(!throttle.shouldRun(at: start.addingTimeInterval(100)))
    }

    @Test("a launch refresh counts as a run")
    func launchCounts() {
        var throttle = ForegroundRefreshThrottle(interval: 60)
        throttle.markRun(at: start)
        #expect(!throttle.shouldRun(at: start.addingTimeInterval(5)))
    }
}
