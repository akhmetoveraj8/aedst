import AedstAnalytics
import AedstCore
import Foundation
import Testing
@testable import AedstTelemetry

/// A fork or test build without accounts has no DSN and no key: the client must be inert, never touch an SDK
/// singleton, and answer flags with the caller's default. (UNVERIFIED: never compiled or run.)
@Suite("TelemetryAnalyticsClient without accounts")
struct TelemetryClientDisabledTests {
    private let client = TelemetryAnalyticsClient(
        configuration: TelemetryConfiguration(
            sentryDSN: nil,
            postHogKey: nil,
            postHogHost: "https://eu.i.posthog.com",
            environment: "local",
            release: "com.aedst.apple@1.0.0+1",
            dist: "1",
            apiHost: nil,
            tracesSampleRate: 1
        )
    )

    @Test("every call is a no-op and flags return the default")
    func inert() {
        client.start(consent: .granted)
        client.setConsent(.denied)
        client.setUserID("user-1")
        client.setUserID(nil)
        client.track(AnalyticsEvent(name: "e", parameters: ["k": "v"]))
        client.recordError(AedstError.unknown(reason: "x"), context: ["a": "b"])
        client.addBreadcrumb("m", category: "c")
        client.reloadFeatureFlags()

        #expect(client.isEnabled("flag", default: true))
        #expect(!client.isEnabled("flag", default: false))
    }
}
