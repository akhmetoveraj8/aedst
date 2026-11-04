import Foundation

/// Exponential backoff with full jitter for idempotent calls. Sleeping goes
/// through `AedstClock`, so tests fast-forward instead of waiting.
public struct RetryPolicy: Sendable {
    public let maxAttempts: Int
    public let baseDelay: TimeInterval
    public let maxDelay: TimeInterval

    public static let standard = RetryPolicy(maxAttempts: 3, baseDelay: 0.5, maxDelay: 8)
    public static let none = RetryPolicy(maxAttempts: 1, baseDelay: 0, maxDelay: 0)

    public init(maxAttempts: Int, baseDelay: TimeInterval, maxDelay: TimeInterval) {
        self.maxAttempts = max(1, maxAttempts)
        self.baseDelay = baseDelay
        self.maxDelay = maxDelay
    }

    /// Upper bound of the delay before retry number `attempt` (1-based).
    public func ceiling(afterAttempt attempt: Int) -> TimeInterval {
        min(maxDelay, baseDelay * pow(2, Double(attempt - 1)))
    }

    /// Runs `operation`, retrying only failures whose `AedstError.isRetryable`
    /// is true. A `rateLimited(retryAfter:)` hint is honoured over the backoff.
    public func run<Success: Sendable>(
        clock: any AedstClock,
        jitter: @Sendable (ClosedRange<TimeInterval>) -> TimeInterval = { .random(in: $0) },
        operation: @Sendable () async -> Outcome<Success>
    ) async -> Outcome<Success> {
        var attempt = 1
        while true {
            let outcome = await operation()
            guard case .failure(let error) = outcome, error.isRetryable, attempt < maxAttempts else {
                return outcome
            }
            var delay = jitter(0...ceiling(afterAttempt: attempt))
            if case .rateLimited(let retryAfter?) = error {
                delay = max(delay, retryAfter)
            }
            do {
                try await clock.sleep(for: delay)
            } catch {
                return outcome // cancelled while backing off
            }
            attempt += 1
        }
    }
}
