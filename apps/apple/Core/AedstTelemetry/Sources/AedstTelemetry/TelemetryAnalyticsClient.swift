import AedstAnalytics
import AedstCore
import Foundation
import PostHog
import Sentry

/// Production `AnalyticsClient` + `FeatureFlagProvider`. One tool per job:
///
/// | Responsibility | Tool | Consent |
/// |---|---|---|
/// | Crashes, handled errors, breadcrumbs, URLSession tracing | Sentry | not required (operational; same as web) |
/// | Product analytics events | PostHog | **opt-in** (`AnalyticsConsent.granted`) |
/// | Feature flags | PostHog | evaluated for the anonymous/identified user; defaults when off |
/// | Session replay | PostHog (iOS only) | **opt-in** (same consent as events) **and** `AEDST_POSTHOG_SESSION_REPLAY`; default off, masked |
///
/// Privacy: Sentry gets the opaque user id only (`sendDefaultPii = false`, no
/// screenshots, no view hierarchy; Sentry session replay is never used —
/// PostHog is the single replay tool). PostHog replay is off unless the build
/// setting enables it, masks all text, text inputs, images and sandboxed system views,
/// never captures network telemetry, and stops as soon as consent is
/// withdrawn. PostHog never runs its push/screen swizzling and never captures
/// crashes (Sentry owns those).
/// Stateless: every call goes to the SDK singletons, so this is a value type.
public struct TelemetryAnalyticsClient: AnalyticsClient, FeatureFlagProvider {
    private let configuration: TelemetryConfiguration

    /// Wraps `configuration`; call `start(consent:)` once at launch.
    public init(configuration: TelemetryConfiguration) {
        self.configuration = configuration
    }

    private var isSentryEnabled: Bool { configuration.sentryDSN != nil }
    private var isPostHogEnabled: Bool { configuration.postHogKey != nil }

    /// Starts the enabled SDKs. Idempotent per process is the caller's job
    /// (`AppDependencies.startServices()` runs once).
    public func start(consent: AnalyticsConsent) {
        if let dsn = configuration.sentryDSN {
            let configuration = self.configuration
            SentrySDK.start { options in
                options.dsn = dsn
                options.releaseName = configuration.release
                options.dist = configuration.dist
                options.environment = configuration.environment
                options.sendDefaultPii = false
                #if os(iOS)
                // UIKit-only options (Sentry 9.30.1 Options.swift guards them with os(iOS) / tvOS / visionOS).
                options.attachScreenshot = false
                options.attachViewHierarchy = false
                #endif
                options.maxBreadcrumbs = 100
                options.enableAutoBreadcrumbTracking = true
                options.enableNetworkBreadcrumbs = true
                // URLSession tracing + propagation to apps/server only (never to
                // object storage: presigned URLs must be sent untouched).
                options.tracesSampleRate = NSNumber(value: configuration.tracesSampleRate)
                options.enableNetworkTracking = true
                options.tracePropagationTargets = configuration.apiHost.map { [$0] } ?? []
                // W3C `traceparent` is what the server's OpenTelemetry understands.
                options.enablePropagateTraceparent = true
                options.enableCaptureFailedRequests = true
                options.failedRequestTargets = configuration.apiHost.map { [$0] } ?? []
            }
        }

        if let key = configuration.postHogKey {
            let config = PostHogConfig(projectToken: key, host: configuration.postHogHost)
            config.optOut = consent != .granted
            config.captureApplicationLifecycleEvents = true
            config.captureScreenViews = false
            config.errorTrackingConfig.autoCapture = false
            #if os(iOS) || os(macOS)
            config.capturePushNotificationSubscriptions = false
            config.capturePushNotificationOpened = false
            #endif
            #if os(iOS)
            if let replay = ReplayConfiguration.make(configuration: configuration, isIOS: true) {
                // Replay is a PostHog-only, iOS-only, opt-in feature. It rides on the
                // same `optOut` flag as events: no consent, no recording.
                config.sessionReplay = true
                // Screenshot mode: the wireframe mode cannot render SwiftUI faithfully.
                // Masking below still applies to the captured screenshots.
                config.sessionReplayConfig.screenshotMode = replay.screenshotMode
                config.sessionReplayConfig.maskAllTextInputs = replay.maskAllTextInputs
                config.sessionReplayConfig.maskAllImages = replay.maskAllImages
                config.sessionReplayConfig.maskAllSandboxedViews = replay.maskAllSandboxedViews
                config.sessionReplayConfig.captureNetworkTelemetry = replay.captureNetworkTelemetry
            }
            #endif
            PostHogSDK.shared.setup(config)
        }
    }

    /// Applies a consent change immediately (opt in/out of product analytics).
    public func setConsent(_ consent: AnalyticsConsent) {
        guard isPostHogEnabled else { return }
        if consent == .granted {
            PostHogSDK.shared.optIn()
        } else {
            #if os(iOS)
            // Explicit stop; `optOut()` also uninstalls the replay integration.
            PostHogSDK.shared.stopSessionRecording()
            #endif
            PostHogSDK.shared.optOut()
            PostHogSDK.shared.reset()
        }
    }

    public func track(_ event: AnalyticsEvent) {
        guard isPostHogEnabled, !PostHogSDK.shared.isOptOut() else { return }
        PostHogSDK.shared.capture(event.name, properties: event.parameters)
    }

    public func setUserID(_ userID: String?) {
        if isSentryEnabled {
            SentrySDK.setUser(userID.map { User(userId: $0) })
        }
        guard isPostHogEnabled else { return }
        if let userID {
            if !PostHogSDK.shared.isOptOut() {
                PostHogSDK.shared.identify(userID)
            }
        } else {
            PostHogSDK.shared.reset()
        }
    }

    public func recordError(_ error: Error, context: [String: String]) {
        guard isSentryEnabled else { return }
        SentrySDK.capture(error: error) { scope in
            for (key, value) in context {
                scope.setTag(value: value, key: key)
            }
            if let aedstError = error as? AedstError {
                scope.setTag(value: aedstError.analyticsCategory, key: "error_category")
            }
        }
    }

    public func addBreadcrumb(_ message: String, category: String) {
        guard isSentryEnabled else { return }
        let breadcrumb = Breadcrumb(level: .info, category: category)
        breadcrumb.message = message
        SentrySDK.addBreadcrumb(breadcrumb)
    }

    public func isEnabled(_ key: String, default defaultValue: Bool) -> Bool {
        guard isPostHogEnabled, PostHogSDK.shared.getFeatureFlag(key) != nil else { return defaultValue }
        return PostHogSDK.shared.isFeatureEnabled(key)
    }

    /// Re-fetches flags (after sign-in, so user-targeted flags apply).
    public func reloadFeatureFlags() {
        guard isPostHogEnabled else { return }
        PostHogSDK.shared.reloadFeatureFlags()
    }
}
