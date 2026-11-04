import AedstCore
import Dispatch
import Network

/// `ConnectivityMonitoring` over `NWPathMonitor`. Each subscription owns its
/// own monitor and cancels it when the stream ends (energy: no monitor lives
/// past its consumer). `isOnline` means "a path exists"; it is a hint for UI
/// (offline banner, retry on reconnect), never a guarantee a request will
/// succeed — requests still handle failure themselves.
public struct NetworkPathMonitor: ConnectivityMonitoring {
    public init() {}

    public var updates: AsyncStream<Bool> {
        AsyncStream(bufferingPolicy: .bufferingNewest(1)) { continuation in
            let monitor = NWPathMonitor()
            monitor.pathUpdateHandler = { path in
                continuation.yield(path.status == .satisfied)
            }
            continuation.onTermination = { _ in monitor.cancel() }
            // concurrency-ok: NWPathMonitor.start(queue:) requires a DispatchQueue (no async/await API); the handler only yields.
            monitor.start(queue: DispatchQueue(label: "com.aedst.apple.network-path", qos: .utility))
        }
    }
}
