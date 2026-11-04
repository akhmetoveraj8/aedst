import AedstCore
import Foundation

/// A stable per-install device identifier for the server's `device_id` field
/// (session/refresh-token binding). Generated once, kept in the device-only
/// Keychain (survives app relaunch and reinstall, never leaves the device).
/// It identifies the *installation*, not the hardware — it is not the IDFV and
/// involves no tracking API.
public struct DeviceIdentifierStore: Sendable {
    private static let key = "aedst.deviceID"
    private let store: any SecureStore
    private let logger = AedstLogger(category: "device")

    public init(store: any SecureStore = Keychain()) {
        self.store = store
    }

    public func deviceID() -> String {
        if let existing = try? store.get(Self.key), !existing.isEmpty {
            return existing
        }
        let created = UUID().uuidString
        do {
            try store.set(created, for: Self.key)
        } catch {
            logger.error("Could not persist the device identifier; using a transient one", error: error)
        }
        return created
    }
}
