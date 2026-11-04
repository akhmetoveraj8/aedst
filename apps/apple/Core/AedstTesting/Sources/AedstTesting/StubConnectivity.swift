import AedstCore

/// `ConnectivityMonitoring` double that replays a fixed sequence of states.
public struct StubConnectivity: ConnectivityMonitoring {
    private let states: [Bool]

    public init(_ states: [Bool]) {
        self.states = states
    }

    public var updates: AsyncStream<Bool> {
        let states = states
        return AsyncStream { continuation in
            for state in states { continuation.yield(state) }
            continuation.finish()
        }
    }
}
