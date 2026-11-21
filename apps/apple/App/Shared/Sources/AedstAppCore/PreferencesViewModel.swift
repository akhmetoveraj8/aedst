import AedstAnalytics
import AedstCore
import AedstPersistence
import Foundation
import Observation

/// The two user-changeable app-level settings (analytics consent, biometric app lock), shared by the Home screen's
/// settings section and the macOS Settings window. One instance lives on the composition root
/// (`AppDependencies.preferences`), so both places show and change the same state.
@MainActor
@Observable
public final class PreferencesViewModel {
    public private(set) var analyticsConsent: AnalyticsConsent
    public private(set) var isAppLockEnabled: Bool

    /// `true` when the device can authenticate with biometrics or the passcode, i.e. the lock can be offered.
    public var canOfferAppLock: Bool { biometrics.isAvailable }

    private let appLockPreference: AppLockPreference
    private let biometrics: any BiometricAuthenticating
    private let readConsent: @MainActor () -> AnalyticsConsent
    private let writeConsent: @MainActor (AnalyticsConsent) throws -> Void
    private let logger = AedstLogger(category: "preferences")

    init(
        appLockPreference: AppLockPreference,
        biometrics: any BiometricAuthenticating,
        readConsent: @escaping @MainActor () -> AnalyticsConsent,
        writeConsent: @escaping @MainActor (AnalyticsConsent) throws -> Void
    ) {
        self.appLockPreference = appLockPreference
        self.biometrics = biometrics
        self.readConsent = readConsent
        self.writeConsent = writeConsent
        self.analyticsConsent = readConsent()
        self.isAppLockEnabled = appLockPreference.isEnabled
    }

    /// Re-reads both values from their stores (the app returned to the foreground, or a launch finished).
    public func reload() {
        analyticsConsent = readConsent()
        isAppLockEnabled = appLockPreference.isEnabled
    }

    /// Persists and applies the analytics choice.
    public func setAnalytics(enabled: Bool) {
        let consent: AnalyticsConsent = enabled ? .granted : .denied
        do {
            try writeConsent(consent)
            analyticsConsent = consent
        } catch {
            logger.error("Could not persist the analytics consent", error: error)
        }
    }

    /// Turning the lock on requires a successful authentication first, so a user can never lock themselves out
    /// with a biometric that does not work.
    public func setAppLock(enabled: Bool) async {
        if enabled {
            let reason = String(localized: "appUnlockReason", bundle: .module)
            guard await biometrics.authenticate(reason: reason) else { return }
        }
        do {
            try appLockPreference.setEnabled(enabled)
            isAppLockEnabled = enabled
        } catch {
            logger.error("Could not persist the app-lock preference", error: error)
        }
    }
}
