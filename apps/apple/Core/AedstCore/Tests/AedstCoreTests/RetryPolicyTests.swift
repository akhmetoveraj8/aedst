import Foundation
import Testing
@testable import AedstCore

@Suite("RetryPolicy")
struct RetryPolicyTests {
    private let policy = RetryPolicy(maxAttempts: 3, baseDelay: 1, maxDelay: 4)

    @Test("backoff ceiling doubles and is capped")
    func ceiling() {
        #expect(policy.ceiling(afterAttempt: 1) == 1)
        #expect(policy.ceiling(afterAttempt: 2) == 2)
        #expect(policy.ceiling(afterAttempt: 3) == 4)
        #expect(policy.ceiling(afterAttempt: 9) == 4)
    }

    @Test("retries a retryable failure until it succeeds")
    func retriesUntilSuccess() async {
        let clock = RecordingClock()
        let attempts = Attempts()

        let result: Outcome<Int> = await policy.run(clock: clock, jitter: { $0.upperBound }) {
            let n = await attempts.increment()
            return n < 3 ? .failure(.unavailable(reason: "flaky")) : .success(n)
        }

        #expect(result.value == 3)
        #expect(await clock.sleeps == [1, 2])
    }

    @Test("gives up after maxAttempts and returns the last failure")
    func givesUp() async {
        let clock = RecordingClock()
        let attempts = Attempts()

        let result: Outcome<Int> = await policy.run(clock: clock, jitter: { $0.upperBound }) {
            _ = await attempts.increment()
            return .failure(.unavailable(reason: "down"))
        }

        #expect(result.error == .unavailable(reason: "down"))
        #expect(await attempts.value == 3)
    }

    @Test("does not retry non-retryable failures")
    func noRetryForClientErrors() async {
        let clock = RecordingClock()
        let attempts = Attempts()

        let result: Outcome<Int> = await policy.run(clock: clock) {
            _ = await attempts.increment()
            return .failure(.invalidInput(fields: ["email"]))
        }

        #expect(result.error == .invalidInput(fields: ["email"]))
        #expect(await attempts.value == 1)
        #expect(await clock.sleeps.isEmpty)
    }

    @Test("honours a server retry-after hint over the backoff")
    func honoursRetryAfter() async {
        let clock = RecordingClock()
        let attempts = Attempts()

        let _: Outcome<Int> = await policy.run(clock: clock, jitter: { $0.lowerBound }) {
            let n = await attempts.increment()
            return n == 1 ? .failure(.rateLimited(retryAfter: 10)) : .success(1)
        }

        #expect(await clock.sleeps == [10])
    }
}

private actor Attempts {
    private(set) var value = 0
    func increment() -> Int {
        value += 1
        return value
    }
}

private actor SleepLog {
    private(set) var sleeps: [TimeInterval] = []
    func record(_ duration: TimeInterval) { sleeps.append(duration) }
}

private struct RecordingClock: AedstClock {
    private let log = SleepLog()
    var now: Date { Date(timeIntervalSince1970: 0) }
    var sleeps: [TimeInterval] { get async { await log.sleeps } }
    func sleep(for duration: TimeInterval) async throws { await log.record(duration) }
}
