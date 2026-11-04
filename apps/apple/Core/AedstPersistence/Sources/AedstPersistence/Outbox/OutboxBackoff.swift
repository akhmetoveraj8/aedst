import Foundation

/// Exponential delay between drain runs after a retryable failure (30 s, 60 s, 120 s, ... capped), the same
/// shape as WorkManager's `BackoffPolicy.EXPONENTIAL` with a 30 s base on Android.
public struct OutboxBackoff: Sendable, Equatable {
    public static let `default` = OutboxBackoff(base: 30, cap: 900)

    public let base: TimeInterval
    public let cap: TimeInterval

    public init(base: TimeInterval, cap: TimeInterval) {
        self.base = base
        self.cap = cap
    }

    /// Delay before the next run after `failures` consecutive retry results (1 = first failure).
    public func delay(afterFailures failures: Int) -> TimeInterval {
        let exponent = min(max(failures - 1, 0), 30)
        return min(cap, base * pow(2, Double(exponent)))
    }
}
