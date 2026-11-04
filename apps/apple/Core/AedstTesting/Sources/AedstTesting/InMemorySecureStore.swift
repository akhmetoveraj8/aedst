import AedstCore
import Foundation

/// `SecureStore` double backed by a dictionary. Optionally fails every write,
/// to exercise the "storage error is surfaced, not swallowed" paths.
public final class InMemorySecureStore: SecureStore, @unchecked Sendable {
    public struct WriteFailure: Error, Equatable {
        public init() {}
    }

    private let lock = NSLock()
    private var values: [String: String] = [:]
    private var failWrites: Bool

    public init(values: [String: String] = [:], failWrites: Bool = false) {
        self.values = values
        self.failWrites = failWrites
    }

    public func setFailWrites(_ fail: Bool) {
        lock.withLock { failWrites = fail }
    }

    public func get(_ key: String) throws -> String? {
        lock.withLock { values[key] }
    }

    public func set(_ value: String, for key: String) throws {
        try lock.withLock {
            if failWrites { throw WriteFailure() }
            values[key] = value
        }
    }

    public func remove(_ key: String) throws {
        lock.withLock { values[key] = nil }
    }

    public var isEmpty: Bool {
        lock.withLock { values.isEmpty }
    }
}
