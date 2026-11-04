import AedstCore
import Foundation
import UserNotifications

/// APNs lifecycle on the client:
///
/// 1. `enablePush()` asks for notification permission (`UNUserNotificationCenter`)
///    and, when granted, calls the platform's `registerForRemoteNotifications`
///    (injected by the app delegate — `UIApplication`/`NSApplication`).
/// 2. The app delegate forwards the device token to `didRegister(deviceToken:)`,
///    which sends `RegisterPushDevice(APNS, hex token, apns_topic = bundle id,
///    apns_sandbox)` and remembers the returned device id.
/// 3. `unregister()` runs on sign-out (*before* the session is cleared, because
///    the RPC is authenticated) so the server stops pushing to this device.
///
/// Notification taps are resolved by the app delegate (it reads the `link`
/// key of the payload) and routed by `App/Shared`.
@MainActor
public final class PushCoordinator {
    /// Static facts about this build.
    public struct Configuration: Sendable {
        /// Bundle id (APNs topic).
        public let topic: String
        /// `true` for development-signed builds (APNs sandbox).
        public let isSandbox: Bool
        /// Shown in the server's "your devices".
        public let deviceName: String

        /// Memberwise initializer.
        public init(topic: String, isSandbox: Bool, deviceName: String) {
            self.topic = topic
            self.isSandbox = isSandbox
            self.deviceName = deviceName
        }

        /// Reads `AEDST_APNS_SANDBOX` (`YES`/`NO`, set per build configuration).
        public static func fromInfoPlist(bundle: Bundle = .main, deviceName: String) -> Configuration {
            let sandbox = (bundle.object(forInfoDictionaryKey: "AEDST_APNS_SANDBOX") as? String)?.uppercased() == "YES"
            return Configuration(
                topic: bundle.bundleIdentifier ?? "com.aedst.apple",
                isSandbox: sandbox,
                deviceName: deviceName
            )
        }
    }

    private static let deviceIDKey = "aedst.push.deviceID"
    private static let tokenKey = "aedst.push.token"

    private let repository: any NotificationsRepository
    private let store: any SecureStore
    private let configuration: Configuration
    private let registerForRemoteNotifications: @MainActor () -> Void
    private let logger = AedstLogger(category: "push")

    /// `registerForRemoteNotifications` is the platform call (injected so this
    /// package does not touch `UIApplication`/`NSApplication`).
    public init(
        repository: any NotificationsRepository,
        store: any SecureStore,
        configuration: Configuration,
        registerForRemoteNotifications: @escaping @MainActor () -> Void
    ) {
        self.repository = repository
        self.store = store
        self.configuration = configuration
        self.registerForRemoteNotifications = registerForRemoteNotifications
    }

    /// Asks for permission (first time only — the system remembers) and
    /// registers with APNs when allowed. Returns whether alerts are allowed.
    @discardableResult
    public func enablePush() async -> Bool {
        do {
            let granted = try await Self.requestAuthorization()
            if granted { registerForRemoteNotifications() }
            return granted
        } catch {
            logger.error("Notification authorization failed", error: error)
            return false
        }
    }

    /// Re-registers on launch when the user already allowed notifications
    /// (APNs may rotate the token; registering is cheap and idempotent).
    public func refreshRegistrationIfAuthorized() async {
        let status = await Self.authorizationStatus()
        if status == .authorized || status == .provisional {
            registerForRemoteNotifications()
        }
    }

    // The notification center is used entirely inside these nonisolated helpers,
    // so no non-Sendable SDK object crosses an actor boundary.
    private nonisolated static func requestAuthorization() async throws -> Bool {
        try await UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .badge, .sound])
    }

    private nonisolated static func authorizationStatus() async -> UNAuthorizationStatus {
        await UNUserNotificationCenter.current().notificationSettings().authorizationStatus
    }

    /// Forwarded from the app delegate.
    public func didRegister(deviceToken: Data) async {
        let token = APNsRegistration.hexString(from: deviceToken)
        let storedToken = try? store.get(Self.tokenKey)
        let storedDeviceID = try? store.get(Self.deviceIDKey)
        if storedToken == token, storedDeviceID != nil { return }

        let registration = APNsRegistration(
            token: token,
            topic: configuration.topic,
            isSandbox: configuration.isSandbox,
            deviceName: configuration.deviceName,
            locale: Locale.current.identifier
        )
        switch await repository.registerPushDevice(registration) {
        case .success(let deviceID):
            do {
                try store.set(deviceID, for: Self.deviceIDKey)
                try store.set(token, for: Self.tokenKey)
            } catch {
                logger.error("Push device id could not be stored", error: error)
            }
        case .failure(let error):
            logger.error("RegisterPushDevice failed (\(error.analyticsCategory))")
        }
    }

    /// Forwarded from the app delegate.
    public func didFailToRegister(error: Error) {
        logger.error("APNs registration failed", error: error)
    }

    /// Tells the server to stop pushing to this device. Call before signing out.
    public func unregister() async {
        guard let deviceID = try? store.get(Self.deviceIDKey) else { return }
        if case .failure(let error) = await repository.unregisterPushDevice(deviceID: deviceID) {
            logger.error("UnregisterPushDevice failed (\(error.analyticsCategory))")
        }
        // Forget locally either way: the next sign-in registers afresh.
        try? store.remove(Self.deviceIDKey)
        try? store.remove(Self.tokenKey)
    }

    /// Extracts the in-app route from a push payload (`link` next to `aps`).
    public nonisolated static func link(fromPayload userInfo: [AnyHashable: Any]) -> String? {
        guard let link = userInfo["link"] as? String, !link.isEmpty else { return nil }
        return link
    }
}
