import Foundation
import Testing
@testable import AedstTelemetry

@Suite("TelemetryConfiguration")
struct TelemetryConfigurationTests {
    private func make(dsn: String?, key: String?) -> TelemetryConfiguration {
        TelemetryConfiguration(
            sentryDSN: dsn,
            postHogKey: key,
            postHogHost: "https://eu.i.posthog.com",
            environment: "production",
            release: "com.aedst.apple.ios@1.0.0+42",
            dist: "42",
            apiHost: "api.aedst.app",
            tracesSampleRate: 0.2
        )
    }

    @Test("empty values and unexpanded build settings disable an SDK")
    func disabledWhenEmpty() {
        let config = make(dsn: "", key: "$(AEDST_POSTHOG_KEY)")
        #expect(config.sentryDSN == nil)
        #expect(config.postHogKey == nil)
    }

    @Test("real values are kept, trimmed")
    func keepsValues() {
        let config = make(dsn: " https://k@o1.ingest.sentry.io/1 ", key: "phc_123")
        #expect(config.sentryDSN == "https://k@o1.ingest.sentry.io/1")
        #expect(config.postHogKey == "phc_123")
    }

    @Test("session replay defaults to off")
    func replayDefaultsOff() {
        #expect(make(dsn: nil, key: "phc_123").postHogSessionReplay == false)
    }

    @Test("replay flag parsing accepts YES/true/1 and rejects everything else")
    func replayFlagParsing() {
        for on in ["YES", "yes", "true", "TRUE", "1", " YES "] {
            #expect(TelemetryConfiguration.flag(on), "\(on) should enable")
        }
        #expect(TelemetryConfiguration.flag(true))
        for off in ["", "NO", "false", "0", "$(AEDST_POSTHOG_SESSION_REPLAY)", "maybe"] {
            #expect(!TelemetryConfiguration.flag(off), "\(off) should not enable")
        }
        #expect(!TelemetryConfiguration.flag(false))
        #expect(!TelemetryConfiguration.flag(nil))
    }

    @Test("the memberwise initializer carries the replay flag")
    func replayFlagStored() {
        let config = TelemetryConfiguration(
            sentryDSN: nil,
            postHogKey: "phc_123",
            postHogHost: "https://eu.i.posthog.com",
            environment: "production",
            release: "r",
            dist: "1",
            apiHost: nil,
            tracesSampleRate: 0.2,
            postHogSessionReplay: true
        )
        #expect(config.postHogSessionReplay)
    }

    @Test("a disabled client is a no-op and flags fall back to the default")
    func disabledClient() {
        let client = TelemetryAnalyticsClient(configuration: make(dsn: nil, key: nil))
        client.setUserID("user-1")
        client.addBreadcrumb("opened", category: "navigation")
        #expect(client.isEnabled("new_inbox", default: true))
        #expect(!client.isEnabled("new_inbox", default: false))
    }
}
