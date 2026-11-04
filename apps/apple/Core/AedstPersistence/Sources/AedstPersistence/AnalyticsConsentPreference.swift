import AedstCore
import Foundation

/// The user's product-analytics consent, stored as a raw `AnalyticsConsent`
/// value (`unknown` / `granted` / `denied`). Kept in the device-only Keychain
/// like `AppLockPreference`, so the app needs no `UserDefaults`
/// required-reason declaration of its own. `AedstPersistence` does not depend
/// on `AedstAnalytics`, so the value is a plain string here; `App/Shared`
/// converts it.
public struct AnalyticsConsentPreference: Sendable {
    private static let key = "aedst.analytics.consent"
    private let store: any SecureStore

    /// Backed by `store` (the Keychain in production).
    public init(store: any SecureStore = Keychain()) {
        self.store = store
    }

    /// The stored raw value, or `nil` when the user has not decided yet.
    public var rawValue: String? {
        try? store.get(Self.key)
    }

    /// Persists the user's decision.
    public func set(_ rawValue: String) throws {
        try store.set(rawValue, for: Self.key)
    }
}
