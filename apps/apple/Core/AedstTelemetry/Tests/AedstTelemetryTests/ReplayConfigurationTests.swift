import Foundation
import Testing
@testable import AedstTelemetry

@Suite("ReplayConfiguration")
struct ReplayConfigurationTests {
    private func make(key: String?, replay: Bool) -> TelemetryConfiguration {
        TelemetryConfiguration(
            sentryDSN: nil,
            postHogKey: key,
            postHogHost: "https://eu.i.posthog.com",
            environment: "production",
            release: "r",
            dist: "1",
            apiHost: nil,
            tracesSampleRate: 0.2,
            postHogSessionReplay: replay
        )
    }

    @Test("enabled replay masks text, inputs, images and sandboxed views and never captures network")
    func maskedByDefault() throws {
        let replay = try #require(ReplayConfiguration.make(configuration: make(key: "phc_1", replay: true), isIOS: true))
        #expect(replay.maskAllTextInputs)
        #expect(replay.maskAllImages)
        #expect(replay.maskAllSandboxedViews)
        #expect(replay.screenshotMode)
        #expect(!replay.captureNetworkTelemetry)
    }

    @Test("replay stays off without the flag")
    func offWithoutFlag() {
        #expect(ReplayConfiguration.make(configuration: make(key: "phc_1", replay: false), isIOS: true) == nil)
    }

    @Test("replay stays off without a PostHog key")
    func offWithoutKey() {
        #expect(ReplayConfiguration.make(configuration: make(key: nil, replay: true), isIOS: true) == nil)
        #expect(ReplayConfiguration.make(configuration: make(key: "$(AEDST_POSTHOG_KEY)", replay: true), isIOS: true) == nil)
    }

    @Test("replay stays off outside iOS")
    func offOutsideIOS() {
        #expect(ReplayConfiguration.make(configuration: make(key: "phc_1", replay: true), isIOS: false) == nil)
    }

    @Test("the masker is installed only when replay is active")
    func maskerActivation() {
        #expect(!ReplayMasking.isActive(for: make(key: "phc_1", replay: false)))
        #expect(!ReplayMasking.isActive(for: make(key: nil, replay: true)))
        #expect(ReplayMasking.isActive(for: make(key: "phc_1", replay: true)) == ReplayConfiguration.isIOS)
    }
}
