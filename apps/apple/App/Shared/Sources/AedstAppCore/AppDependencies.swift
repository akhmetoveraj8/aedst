import AdminData
import AdminDomain
import AedstAnalytics
import AedstCore
import AedstDesignSystem
import AedstMedia
import AedstNetwork
import AedstPersistence
import AedstTelemetry
import AuthData
import AuthDomain
import Connect
import Foundation
import MediaData
import MediaDomain
import NotificationsData
import NotificationsDomain
import NotificationsPresentation
import SearchData
import SearchDomain
import TasksData
import TasksDomain

/// The app's single composition root — every concrete implementation is
/// constructed exactly once, here, and only protocol types cross into
/// `Presentation`. `App/iOS`'s and `App/macOS`'s app delegates both build one
/// `AppDependencies` and hand it to their own `RootView`; nothing
/// platform-specific belongs in this type except what the delegate injects
/// (APNs registration, the icon badge, the device name).
///
/// Every external effect (Keychain, network reachability, biometrics, time,
/// telemetry) is an injectable parameter, so tests construct the whole graph
/// with doubles and no SDK ever starts in a unit test.
@MainActor
public final class AppDependencies {
    /// The `admin` role name (server default policy: `/aedst.admin.v1.AdminService/*=admin`).
    public static let adminRole = "admin"

    public let analytics: AnalyticsClient
    public let featureFlags: FeatureFlagProvider
    public let clock: any AedstClock
    public let sessionStore: any SessionStore
    public let authRepository: AuthRepository
    public let connectivity: any ConnectivityMonitoring
    public let biometrics: any BiometricAuthenticating
    public let appLockPreference: AppLockPreference
    public let consentPreference: AnalyticsConsentPreference
    /// Analytics consent and app lock: the one source of truth for the Home settings and the macOS Settings window.
    public let preferences: PreferencesViewModel

    /// Client that attaches the bearer token. A feature's remote data source
    /// uses it together with `authorizedRequests` (refresh-and-retry on 401).
    public let authenticatedClient: ProtocolClient
    public let authorizedRequests: AuthorizedRequestExecutor

    /// App Attest (ADR-0016). Fail-open and best-effort: no user flow waits for it. Unsupported devices
    /// (simulator, macOS) get `NoopDeviceAttestation` and never touch the network.
    public let attestation: AttestationCoordinator

    public let taskRepository: any TaskRepository
    /// Offline-tolerant writes: queue (per feature: `taskOutbox`) plus the coordinator that drains it.
    public let outbox: AedstOutbox
    public let taskOutbox: TaskOutboxQueue
    /// "The server refuses this app version" (ADR-0009); `RootViewModel` shows the blocking upgrade screen.
    public let upgradeMonitor: ClientUpgradeMonitor
    /// Capability negotiation (behaviour `capability-negotiation`): which built features the server allows.
    public let capabilities: CapabilitiesService
    /// Where the Info.plist says the app lives on the App Store (`nil` until `AEDST_APP_STORE_ID` is set).
    public let appStoreURL: URL?
    public let searchRepository: any SearchRepository
    public let notificationsRepository: any NotificationsRepository
    public let mediaRepository: any MediaRepository
    public let adminRepository: any AdminRepository

    /// Background presigned-PUT uploads (one session per process).
    public let uploader: BackgroundUploader
    public let push: PushCoordinator
    public let badge: UnreadBadgeModel
    /// Links from notification taps (app delegate → `RootView`).
    public let linkInbox = AppLinkInbox()
    /// Long-lived view models shared across screens (the task list); cleared on sign-out.
    let sessionModels = SessionScopedModels()

    /// Redaction for views marked `aedstSensitive()`: PostHog's mask region when
    /// session replay is active, identity otherwise. `RootView` puts it in the environment.
    public let sensitiveContentMasker: AedstSensitiveContentMasker

    /// Platform hook that asks the system for a background drain (iOS: `BGAppRefreshTask`); see `AppDependencies+Outbox`.
    let scheduleOutboxSync: @Sendable (TimeInterval) -> Void
    private let telemetry: TelemetryAnalyticsClient
    private let rolesClaim: String
    let deviceIdentifiers: DeviceIdentifierStore
    /// False in `AppLaunchMode.uiTesting` and when the attester reports the device unsupported.
    private let attestationEnabled: Bool
    private var servicesStarted = false
    #if canImport(MetricKit)
    private let diagnostics: DiagnosticsSubscriber
    #endif

    /// - Parameters:
    ///   - telemetry: `nil` reads `AEDST_SENTRY_DSN`/`AEDST_POSTHOG_*` from Info.plist
    ///     (empty in tests and in forks without accounts → SDKs stay off).
    ///   - launchMode: `.uiTesting` (DEBUG + `-aedst-ui-testing`) swaps the Keychain
    ///     for an in-memory store and turns telemetry off; always `.normal` in Release.
    ///   - oidc: `nil` reads the `AEDST_OIDC_*` Info.plist keys; with no usable issuer and client id (and in
    ///     `.uiTesting` launches) `OIDCConfiguration.unconfigured` is used, so sign-in fails instead of
    ///     reaching any identity provider. Inject a configuration (and a `webAuthenticator` double) in tests.
    ///   - webAuthenticator: `nil` uses `ASWebAuthenticator`.
    ///   - deviceAttestation: `nil` uses App Attest on supported iOS devices and a no-op elsewhere.
    ///     Inject a double in tests (an unsupported one keeps attestation off).
    ///   - outboxStorage: `nil` = on disk (in memory for UI-test launches); tests pass `.memory`.
    ///   - registerForRemoteNotifications / setAppBadge / deviceName / scheduleOutboxSync: platform
    ///     hooks supplied by the app delegate.
    public init(
        environment: APIEnvironment = .fromInfoPlist(),
        secureStore: any SecureStore = Keychain(),
        clock: any AedstClock = SystemClock(),
        connectivity: any ConnectivityMonitoring = NetworkPathMonitor(),
        biometrics: any BiometricAuthenticating = LocalAuthenticator(),
        telemetry: TelemetryConfiguration? = nil,
        bundle: Bundle = .main,
        launchMode: AppLaunchMode = .current,
        oidc: OIDCConfiguration? = nil,
        webAuthenticator: (any WebAuthenticator)? = nil,
        deviceAttestation: (any DeviceAttesting)? = nil,
        outboxStorage: AedstOutbox.Storage? = nil,
        deviceName: String = "Apple device",
        registerForRemoteNotifications: @escaping @MainActor () -> Void = {},
        setAppBadge: @escaping @MainActor (Int) -> Void = { _ in },
        scheduleOutboxSync: @escaping @Sendable (TimeInterval) -> Void = { _ in }
    ) {
        // Hermetic UI-test launch (DEBUG only): in-memory store, telemetry off.
        let secureStore = launchMode.secureStore(replacing: secureStore)
        let telemetry = telemetry ?? launchMode.telemetryOverride
        let telemetryConfiguration = telemetry ?? .fromInfoPlist(
            bundle: bundle,
            apiBaseURL: environment.baseURL,
            environment: Self.name(of: environment)
        )
        let telemetryClient = TelemetryAnalyticsClient(configuration: telemetryConfiguration)
        self.sensitiveContentMasker = ReplayMasking.isActive(for: telemetryConfiguration)
            ? AedstSensitiveContentMasker { ReplayMasking.mask($0) }
            : .identity
        self.telemetry = telemetryClient
        self.analytics = telemetryClient
        self.featureFlags = telemetryClient
        self.clock = clock
        self.connectivity = connectivity
        self.biometrics = biometrics
        let appLockPreference = AppLockPreference(store: secureStore)
        let consentPreference = AnalyticsConsentPreference(store: secureStore)
        self.appLockPreference = appLockPreference
        self.consentPreference = consentPreference
        self.preferences = PreferencesViewModel(
            appLockPreference: appLockPreference,
            biometrics: biometrics,
            readConsent: { consentPreference.rawValue.flatMap(AnalyticsConsent.init(rawValue:)) ?? .unknown },
            writeConsent: { consent in
                try consentPreference.set(consent.rawValue)
                telemetryClient.setConsent(consent)
            }
        )
        self.deviceIdentifiers = DeviceIdentifierStore(store: secureStore)
        self.rolesClaim = (bundle.object(forInfoDictionaryKey: "AEDST_ROLES_CLAIM") as? String)
            .flatMap { $0.isEmpty || $0.hasPrefix("$(") ? nil : $0 } ?? AccessTokenClaims.defaultRolesClaim

        // The plain (interceptor-free) client carries no bearer token: capabilities uses it, and it
        // breaks the client <-> token store dependency cycle.
        let identity = ClientIdentity.fromBundle(bundle)
        let upgradeMonitor = ClientUpgradeMonitor()
        self.upgradeMonitor = upgradeMonitor
        self.appStoreURL = Self.appStoreURL(bundle: bundle)
        self.scheduleOutboxSync = scheduleOutboxSync
        let plainClient = ConnectClientFactory.makePlainClient(
            environment: environment,
            identity: identity,
            upgradeMonitor: upgradeMonitor
        )

        // Sign-in is the browser flow only (Authorization Code + PKCE, ADR-0001). Hermetic UI tests
        // cannot drive a system browser, so they use the placeholder unless a config is injected.
        let oidcConfiguration = oidc
            ?? (launchMode == .uiTesting ? nil : OIDCConfiguration.fromBundle(bundle))
            ?? OIDCConfiguration.unconfigured
        let discovery = OIDCDiscovery(configuration: oidcConfiguration)
        let tokenClient = URLSessionOIDCTokenClient(configuration: oidcConfiguration, discovery: discovery)
        let oidcRefresher = OIDCTokenRefresher(tokenClient: tokenClient, configuration: oidcConfiguration, clock: clock)
        // The refresh token belongs to the IdP, so refresh goes to its token endpoint.
        let tokenStore = KeychainTokenStore(
            store: secureStore,
            clock: clock,
            refreshHandler: { refreshToken in await oidcRefresher.refresh(refreshToken: refreshToken) }
        )
        self.sessionStore = tokenStore
        self.authRepository = OIDCAuthRepository(
            configuration: oidcConfiguration,
            discovery: discovery,
            tokenClient: tokenClient,
            webAuthenticator: webAuthenticator ?? ASWebAuthenticator(
                prefersEphemeralSession: oidcConfiguration.prefersEphemeralBrowserSession
            ),
            sessionStore: tokenStore,
            clock: clock
        )
        let client = ConnectClientFactory.makeClient(
            environment: environment,
            tokenProvider: tokenStore,
            identity: identity,
            upgradeMonitor: upgradeMonitor
        )
        let executor = AuthorizedRequestExecutor(tokenProvider: tokenStore)
        self.authenticatedClient = client
        self.authorizedRequests = executor

        let attester = deviceAttestation ?? Self.makeDeviceAttestation(store: secureStore)
        self.attestationEnabled = launchMode != .uiTesting && attester.isSupported
        self.attestation = AttestationCoordinator(
            attestation: attester,
            remote: ConnectAppAttestRemote(client: client, executor: executor),
            bundleID: bundle.bundleIdentifier ?? ""
        )

        self.taskRepository = ConnectTaskRepository(client: client, executor: executor)
        let outbox = Self.makeOutbox(
            storage: outboxStorage,
            launchMode: launchMode,
            handlers: Self.outboxHandlers(client: client, executor: executor),
            clock: clock,
            scheduleSync: scheduleOutboxSync,
            analytics: telemetryClient
        )
        self.outbox = outbox
        self.capabilities = Self.makeCapabilities(
            plainClient: plainClient,
            identity: identity,
            outbox: outbox,
            upgradeMonitor: upgradeMonitor
        )
        self.taskOutbox = TaskOutboxQueue(outbox: outbox.repository, failures: outbox.repository)
        self.searchRepository = ConnectSearchRepository(client: client, executor: executor)
        let notifications = ConnectNotificationsRepository(client: client, executor: executor)
        self.notificationsRepository = notifications
        let media = ConnectMediaRepository(client: client, executor: executor)
        self.mediaRepository = media
        self.adminRepository = ConnectAdminRepository(client: client, executor: executor)

        self.badge = UnreadBadgeModel(repository: notifications, setAppBadge: setAppBadge)
        self.push = PushCoordinator(
            repository: notifications,
            store: secureStore,
            configuration: .fromInfoPlist(bundle: bundle, deviceName: deviceName),
            registerForRemoteNotifications: registerForRemoteNotifications
        )

        // Creating the uploader does not open the background session (lazy).
        let uploader = BackgroundUploader()
        self.uploader = uploader
        let logger = AedstLogger(category: "upload")
        let mediaOutbox = MediaOutboxQueue(outbox: outbox.repository)
        // An upload that finished after the app was terminated: queue the last protocol step (CompleteUpload).
        uploader.setOrphanCompletionHandler { mediaID, status, error in
            guard error == nil, let status, (200..<300).contains(status), !mediaID.isEmpty else {
                logger.error("Background upload \(mediaID) did not complete (status \(status.map(String.init) ?? "none"))")
                return
            }
            // Durable: the outbox row survives suspension or an offline relaunch and is delivered with an
            // Idempotency-Key; a bare Task here could be cut off before the request went out.
            Task { _ = await mediaOutbox.enqueueComplete(mediaID: mediaID) }
        }

        #if canImport(MetricKit)
        self.diagnostics = DiagnosticsSubscriber(analytics: telemetryClient)
        #endif
    }

    /// Starts long-lived, launch-time services once: telemetry (consent-aware),
    /// MetricKit diagnostics, the background upload session.
    public func startServices() {
        guard !servicesStarted else { return }
        servicesStarted = true
        telemetry.start(consent: analyticsConsent)
        uploader.activate()
        #if canImport(MetricKit)
        diagnostics.start()
        #endif
    }

    // MARK: Consent

    /// Current product-analytics consent (`unknown` until the user decides).
    public var analyticsConsent: AnalyticsConsent {
        consentPreference.rawValue.flatMap(AnalyticsConsent.init(rawValue:)) ?? .unknown
    }

    /// Persists and applies the user's analytics choice.
    public func setAnalyticsConsent(_ consent: AnalyticsConsent) throws {
        try consentPreference.set(consent.rawValue)
        telemetry.setConsent(consent)
    }

    // MARK: Session-derived facts

    /// Whether the current access token carries the admin role. UX only — the
    /// server's RoleInterceptor authorizes every AdminService call.
    public func isAdmin() async -> Bool {
        guard let token = await sessionStore.currentAccessToken(),
              let claims = AccessTokenClaims(jwt: token, rolesClaim: rolesClaim)
        else { return false }
        return claims.hasRole(Self.adminRole)
    }

    /// Ties telemetry to the signed-in user (opaque id only) and refreshes flags.
    /// Also starts App Attest enrollment in a detached best-effort task: never awaited by the UI, at most one
    /// attempt per launch / sign-in, failures are logged by the coordinator and otherwise ignored.
    public func didSignIn(userID: String) {
        analytics.setUserID(userID)
        telemetry.reloadFeatureFlags()
        if attestationEnabled {
            let attestation = self.attestation
            Task.detached(priority: .utility) { await attestation.enrollIfNeeded() } // concurrency-ok: best-effort
        }
    }

    /// Clears per-user state that is not owned by the session store. The App Attest key goes too: the server
    /// binds a key to the user that enrolled it, so the next user must enroll a fresh one (ADR-0016).
    public func didSignOut() async {
        analytics.setUserID(nil)
        badge.reset()
        // Queued writes belong to the user who made them: never deliver them under the next user's token.
        try? await outbox.repository.removeAll()
        await attestation.reset()
        sessionModels.reset()
        await AedstImagePipeline.removeAll()
    }

    /// App Attest on supported iOS/iPadOS devices; the server validates iOS App IDs only (no macOS `aclBlob`
    /// handling), so every other platform, simulators included, gets the no-op.
    private static func makeDeviceAttestation(store: any SecureStore) -> any DeviceAttesting {
        #if canImport(DeviceCheck) && os(iOS)
        let backend = DCAppAttestBackend()
        return backend.isSupported ? AppAttestService(backend: backend, store: store) : NoopDeviceAttestation()
        #else
        return NoopDeviceAttestation()
        #endif
    }

    private static func name(of environment: APIEnvironment) -> String {
        switch environment {
        case .local: "local"
        case .staging: "staging"
        case .production: "production"
        }
    }
}
