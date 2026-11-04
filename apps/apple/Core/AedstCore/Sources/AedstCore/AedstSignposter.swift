import os

/// `OSSignposter` facade: intervals show up in Instruments' os_signpost
/// track, which is how startup, login and database-open times get profiled
/// without a third-party APM.
public struct AedstSignposter: Sendable {
    private let signposter: OSSignposter

    public init(category: String, subsystem: String = "com.aedst.apple") {
        self.signposter = OSSignposter(subsystem: subsystem, category: category)
    }

    /// Measures `body` as one named interval.
    public func measure<T>(_ name: StaticString, _ body: () async throws -> T) async rethrows -> T {
        let state = signposter.beginInterval(name)
        defer { signposter.endInterval(name, state) }
        return try await body()
    }

    /// Synchronous variant for launch-path work.
    public func measureSync<T>(_ name: StaticString, _ body: () throws -> T) rethrows -> T {
        let state = signposter.beginInterval(name)
        defer { signposter.endInterval(name, state) }
        return try body()
    }
}
