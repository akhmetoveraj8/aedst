import AedstCore

/// Analytics/crash-reporting facade — feature modules depend on this
/// protocol, never on an SDK type directly. The production binding is
/// `Core/AedstTelemetry`'s `TelemetryAnalyticsClient` (product analytics →
/// PostHog, consent-gated; errors and breadcrumbs → Sentry), composed only in
/// `App/Shared`. Mirrors `apps/android/core/analytics`'s facade + no-op split.
public protocol AnalyticsClient: Sendable {
    /// Product-analytics event (dropped unless the user granted analytics consent).
    func track(_ event: AnalyticsEvent)
    /// Opaque user id only — never an email or name. `nil` on sign-out.
    func setUserID(_ userID: String?)
    /// Handled error worth reporting (error reporting is operational: no consent needed).
    func recordError(_ error: Error, context: [String: String])
    /// Breadcrumb attached to the next error report (navigation, user actions).
    func addBreadcrumb(_ message: String, category: String)
}

extension AnalyticsClient {
    /// Default: providers without breadcrumbs ignore them.
    public func addBreadcrumb(_ message: String, category: String) {}
}

/// Remote feature flags (PostHog in production). Unknown or not-yet-loaded
/// flags return `defaultValue`, so a flag can never break a screen offline.
public protocol FeatureFlagProvider: Sendable {
    /// Whether `key` is enabled for the current user.
    func isEnabled(_ key: String, default defaultValue: Bool) -> Bool
}

/// Flags off (`defaultValue`) — tests, previews, and builds without a PostHog key.
public struct StaticFeatureFlags: FeatureFlagProvider {
    private let overrides: [String: Bool]

    /// `overrides` win over the caller's default.
    public init(_ overrides: [String: Bool] = [:]) {
        self.overrides = overrides
    }

    public func isEnabled(_ key: String, default defaultValue: Bool) -> Bool {
        overrides[key] ?? defaultValue
    }
}

/// The user's product-analytics choice. `unknown` behaves exactly like
/// `denied` (nothing is sent) until the user decides.
public enum AnalyticsConsent: String, Sendable, Equatable {
    case unknown
    case granted
    case denied
}

public struct AnalyticsEvent: Sendable {
    public let name: String
    public let parameters: [String: String]

    public init(name: String, parameters: [String: String] = [:]) {
        self.name = name
        self.parameters = parameters
    }
}

/// Default binding until a real provider (Firebase, Amplitude, ...) is
/// wired in `App/Shared`'s composition root — logs through `AedstLogger`
/// instead of silently dropping events, so debug builds still show what
/// *would* have been sent.
public struct NoopAnalyticsClient: AnalyticsClient {
    private let logger = AedstLogger(category: "Analytics")

    public init() {}

    public func track(_ event: AnalyticsEvent) {
        logger.debug("track(\(event.name), \(event.parameters))")
    }

    public func setUserID(_ userID: String?) {
        logger.debug("setUserID(\(userID ?? "nil"))")
    }

    public func recordError(_ error: Error, context: [String: String]) {
        logger.error("recordError(\(context))", error: error)
    }
}
