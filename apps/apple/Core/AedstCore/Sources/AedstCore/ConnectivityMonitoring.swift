/// Reachability as a stream of `isOnline` values (the current state first,
/// then every change). `AedstNetwork` implements it with `NWPathMonitor`;
/// UI and tests depend only on this protocol.
public protocol ConnectivityMonitoring: Sendable {
    var updates: AsyncStream<Bool> { get }
}
