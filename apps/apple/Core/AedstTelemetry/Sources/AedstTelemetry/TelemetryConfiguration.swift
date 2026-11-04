import Foundation

/// Telemetry settings, read from the app's Info.plist, which gets them from
/// build settings (`Config/*.xcconfig`, or `xcodebuild AEDST_SENTRY_DSN=...`
/// in CI). An empty DSN/key disables that SDK entirely — a fork without
/// accounts ships with no telemetry at all.
///
/// Info.plist keys: `AEDST_SENTRY_DSN`, `AEDST_POSTHOG_KEY`,
/// `AEDST_POSTHOG_HOST`, `AEDST_POSTHOG_SESSION_REPLAY`, `AEDST_TELEMETRY_ENVIRONMENT`.
public struct TelemetryConfiguration: Sendable, Equatable {
    /// Sentry DSN; `nil` disables error reporting.
    public let sentryDSN: String?
    /// PostHog project token; `nil` disables product analytics and feature flags.
    public let postHogKey: String?
    /// PostHog ingestion host (e.g. `https://eu.i.posthog.com`).
    public let postHogHost: String
    /// `local` / `staging` / `production`.
    public let environment: String
    /// `"<bundle id>@<marketing version>+<build>"` — Sentry's release convention;
    /// CI uploads dSYMs under the same name.
    public let release: String
    /// The build number (Sentry `dist`).
    public let dist: String
    /// Host of `apps/server`: the only destination that receives trace headers.
    public let apiHost: String?
    /// Traces sample rate (1 locally, sampled in production — same as web).
    public let tracesSampleRate: Double
    /// PostHog session replay (iOS only; masked, consent-gated, default off).
    /// Requires `postHogKey`; the build setting must opt in explicitly.
    public let postHogSessionReplay: Bool

    /// Memberwise initializer (tests).
    public init(
        sentryDSN: String?,
        postHogKey: String?,
        postHogHost: String,
        environment: String,
        release: String,
        dist: String,
        apiHost: String?,
        tracesSampleRate: Double,
        postHogSessionReplay: Bool = false
    ) {
        self.sentryDSN = Self.nonEmpty(sentryDSN)
        self.postHogKey = Self.nonEmpty(postHogKey)
        self.postHogHost = postHogHost
        self.environment = environment
        self.release = release
        self.dist = dist
        self.apiHost = apiHost
        self.tracesSampleRate = tracesSampleRate
        self.postHogSessionReplay = postHogSessionReplay
    }

    /// Reads the configuration from `bundle`'s Info.plist.
    public static func fromInfoPlist(bundle: Bundle = .main, apiBaseURL: URL, environment: String) -> TelemetryConfiguration {
        func value(_ key: String) -> String? { bundle.object(forInfoDictionaryKey: key) as? String }
        let bundleID = bundle.bundleIdentifier ?? "com.aedst.apple"
        let version = value("CFBundleShortVersionString") ?? "0"
        let build = value("CFBundleVersion") ?? "0"
        return TelemetryConfiguration(
            sentryDSN: value("AEDST_SENTRY_DSN"),
            postHogKey: value("AEDST_POSTHOG_KEY"),
            postHogHost: nonEmpty(value("AEDST_POSTHOG_HOST")) ?? "https://eu.i.posthog.com",
            environment: environment,
            release: "\(bundleID)@\(version)+\(build)",
            dist: build,
            apiHost: apiBaseURL.host,
            tracesSampleRate: environment == "production" ? 0.2 : 1,
            postHogSessionReplay: flag(bundle.object(forInfoDictionaryKey: "AEDST_POSTHOG_SESSION_REPLAY"))
        )
    }

    /// Parses a boolean build setting: `YES` / `true` / `1` (case-insensitive,
    /// or a real plist boolean) are on; empty, unset, an unexpanded `$(VAR)`
    /// and anything else are off.
    static func flag(_ raw: Any?) -> Bool {
        if let bool = raw as? Bool { return bool }
        guard let string = nonEmpty(raw as? String) else { return false }
        return ["yes", "true", "1"].contains(string.lowercased())
    }

    /// Treats empty strings and unexpanded `$(VAR)` placeholders as "not set".
    static func nonEmpty(_ raw: String?) -> String? {
        guard let trimmed = raw?.trimmingCharacters(in: .whitespacesAndNewlines),
              !trimmed.isEmpty, !trimmed.hasPrefix("$(")
        else { return nil }
        return trimmed
    }
}
