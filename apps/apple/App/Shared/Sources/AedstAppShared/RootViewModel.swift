import AedstAnalytics
import AedstCore
import AedstPersistence
import Auth
import Foundation
import Observation
import SwiftUI

/// App-level state: who is signed in (and whether they are an admin), whether
/// the network is reachable, whether the biometric lock is covering the UI,
/// and the analytics-consent choice. One place, unit-testable without SwiftUI.
@MainActor
@Observable
public final class RootViewModel {
    public private(set) var session: Session?
    public private(set) var isOnline = true
    /// The lock screen must be shown (needs an unlock to dismiss).
    public private(set) var isLocked = false
    /// The app is not active: cover content so the app-switcher snapshot and
    /// screen recordings never show account data (only when app lock is on).
    public private(set) var isObscured = false
    /// From the access token's roles claim — UX only, the server authorizes.
    public private(set) var isAdmin = false
    /// The server refuses this app version (`CLIENT_UPGRADE_REQUIRED`): a blocking screen covers the app.
    /// Not reset by sign-out or sign-in; only an app update (a new process) clears it.
    public private(set) var isUpgradeRequired = false
    /// `restore()` finished (session and preferences are known): the point where a saved navigation path may be applied.
    public private(set) var hasRestored = false

    private let dependencies: AppDependencies
    /// Foreground refreshes (capabilities, badge, outbox drain) run at most once a minute; see `refreshOnForeground`.
    @ObservationIgnored private var foregroundThrottle = ForegroundRefreshThrottle(interval: 60)

    public init(dependencies: AppDependencies) {
        self.dependencies = dependencies
    }

    public var isSignedIn: Bool { session != nil }
    public var canOfferAppLock: Bool { dependencies.preferences.canOfferAppLock }
    public var isAppLockEnabled: Bool { dependencies.preferences.isAppLockEnabled }
    public var analyticsConsent: AnalyticsConsent { dependencies.preferences.analyticsConsent }
    public var showsLockScreen: Bool { isLocked || isObscured }

    /// Drives everything for the lifetime of the root view (`.task`): restores
    /// the session, then watches session events and reachability until cancelled.
    public func run() async {
        dependencies.startServices()
        await restore()
        foregroundThrottle.markRun(at: dependencies.clock.now)
        // The observers start at once. The network refreshes are child tasks too: awaiting them before the group
        // (as this once did) held back the session and connectivity observers for up to a request timeout.
        await withTaskGroup(of: Void.self) { group in
            group.addTask { await self.observeSessionEvents() }
            group.addTask { await self.observeConnectivity() }
            group.addTask { await self.observeUpgradeRequired() }
            group.addTask { await self.dependencies.capabilities.refresh() }
            if self.isSignedIn {
                group.addTask { await self.refreshSignedInServices() }
            }
        }
    }

    /// Restores the persisted session without any network call, so the app
    /// opens signed-in — including offline or with an expired access token.
    func restore() async {
        if case .success(let restored) = await dependencies.restoreSessionUseCase(NoInput()) {
            session = restored
        }
        dependencies.preferences.reload()
        isLocked = session != nil && lockConfigured
        if let session {
            dependencies.didSignIn(userID: session.userID)
            isAdmin = await dependencies.isAdmin()
        }
        hasRestored = true
    }

    func observeSessionEvents() async {
        for await event in dependencies.sessionStore.events {
            handle(event)
        }
    }

    func observeConnectivity() async {
        for await online in dependencies.connectivity.updates {
            isOnline = online
            dependencies.outboxConnectivityChanged(isOnline: online)
        }
    }

    func observeUpgradeRequired() async {
        for await _ in dependencies.upgradeMonitor.events {
            handleUpgradeRequired()
        }
    }

    func handleUpgradeRequired() {
        isUpgradeRequired = true
    }

    /// Where the upgrade screen sends the user (`nil` until `AEDST_APP_STORE_ID` is configured).
    public var appStoreURL: URL? { dependencies.appStoreURL }

    /// Whether the UI may show or open a built feature (`AppFeature.*`): built AND enabled by the server.
    /// Read inside a view body so Observation re-renders when a fetch changes the answer.
    public func isFeatureEnabled(_ feature: String) -> Bool {
        dependencies.capabilities.isEnabled(feature)
    }

    /// A newer release exists (non-blocking; the blocking case goes through `isUpgradeRequired`).
    public var isUpdateRecommended: Bool { dependencies.capabilities.isUpdateRecommended }

    func handle(_ event: SessionEvent) {
        switch event {
        case .expired:
            session = nil
            isLocked = false
            isAdmin = false
            Task { await dependencies.didSignOut() }
        }
    }

    public func didSignIn(_ session: Session) {
        self.session = session
        dependencies.didSignIn(userID: session.userID)
        Task {
            isAdmin = await dependencies.isAdmin()
            await refreshSignedInServices()
        }
    }

    /// Unread badge + APNs re-registration (only if the user already allowed
    /// notifications — the permission prompt is an explicit user action).
    private func refreshSignedInServices() async {
        await dependencies.badge.refresh()
        await dependencies.push.refreshRegistrationIfAuthorized()
    }

    /// Asks for notification permission and registers with APNs.
    public func enablePushNotifications() async {
        await dependencies.push.enablePush()
    }

    public func signOut() async {
        // Unregister while the session is still valid (the RPC is authenticated).
        await dependencies.push.unregister()
        _ = await dependencies.logoutUseCase(NoInput())
        await dependencies.didSignOut()
        session = nil
        isAdmin = false
        isLocked = false
        isObscured = false
    }

    /// Persists and applies the analytics choice.
    public func setAnalytics(enabled: Bool) {
        dependencies.preferences.setAnalytics(enabled: enabled)
    }

    // MARK: App lock

    private var lockConfigured: Bool {
        dependencies.preferences.isAppLockEnabled && dependencies.biometrics.isAvailable
    }

    public func handleScenePhase(_ phase: ScenePhase) {
        if phase == .active {
            // Another window (the macOS Settings scene) may have changed a preference while this one was inactive.
            dependencies.preferences.reload()
            refreshOnForeground()
        }
        if phase == .background, isSignedIn {
            dependencies.scheduleOutboxBackgroundSyncIfPending()
        }
        guard session != nil, lockConfigured else {
            isObscured = false
            return
        }
        switch phase {
        case .active:
            isObscured = false
        case .inactive:
            isObscured = true
        case .background:
            isObscured = true
            isLocked = true
        @unknown default:
            isObscured = true
        }
    }

    /// Resume: capabilities are public, so refresh them signed in or not; badge and outbox only when signed in.
    /// Throttled by `foregroundThrottle`: a quick app-switch must not cost three requests each time.
    private func refreshOnForeground() {
        guard foregroundThrottle.shouldRun(at: dependencies.clock.now) else { return }
        let capabilities = dependencies.capabilities
        Task { await capabilities.refresh() }
        if isSignedIn {
            Task { await dependencies.badge.refresh() }
            dependencies.drainOutbox()
        }
    }

    public func unlock() async {
        let reason = String(localized: "appUnlockReason", bundle: .module)
        if await dependencies.biometrics.authenticate(reason: reason) {
            isLocked = false
            isObscured = false
        }
    }

    /// Turning the lock on requires a successful authentication first, so a
    /// user can never lock themselves out with a biometric that does not work.
    public func setAppLock(enabled: Bool) async {
        await dependencies.preferences.setAppLock(enabled: enabled)
    }
}
