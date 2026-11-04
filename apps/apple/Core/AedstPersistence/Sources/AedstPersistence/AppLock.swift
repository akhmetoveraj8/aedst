import AedstCore
import Foundation

/// Biometric / device-passcode gate for the app UI. This protects *access to
/// the app* (Face ID / Touch ID / Optic ID with passcode fallback); the tokens
/// themselves stay in the device-only Keychain and are not biometry-bound, so
/// background-safe flows keep working.
public protocol BiometricAuthenticating: Sendable {
    /// `true` when the device can evaluate `.deviceOwnerAuthentication`
    /// (biometrics enrolled, or at least a passcode set).
    var isAvailable: Bool { get }
    func authenticate(reason: String) async -> Bool
}

#if canImport(LocalAuthentication)
import LocalAuthentication

/// Production implementation over `LAContext` (iOS, macOS, watchOS, visionOS).
public struct LocalAuthenticator: BiometricAuthenticating {
    public init() {}

    public var isAvailable: Bool {
        var error: NSError?
        return LAContext().canEvaluatePolicy(.deviceOwnerAuthentication, error: &error)
    }

    public func authenticate(reason: String) async -> Bool {
        let context = LAContext()
        do {
            return try await context.evaluatePolicy(.deviceOwnerAuthentication, localizedReason: reason)
        } catch {
            return false // cancelled, failed or lockout — the UI stays locked
        }
    }
}
#endif

/// The user's "require unlock" choice. Stored in the Keychain (device-only)
/// instead of `UserDefaults`: it is a security setting, and this avoids a
/// required-reason API declaration in the privacy manifest.
public struct AppLockPreference: Sendable {
    private static let key = "aedst.appLock.enabled"
    private let store: any SecureStore

    public init(store: any SecureStore = Keychain()) {
        self.store = store
    }

    public var isEnabled: Bool {
        (try? store.get(Self.key)) == "1"
    }

    public func setEnabled(_ enabled: Bool) throws {
        if enabled {
            try store.set("1", for: Self.key)
        } else {
            try store.remove(Self.key)
        }
    }
}
