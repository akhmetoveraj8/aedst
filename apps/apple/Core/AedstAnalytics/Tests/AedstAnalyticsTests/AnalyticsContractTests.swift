import Foundation
import Testing
@testable import AedstAnalytics

/// A client that implements only the required methods, like a minimal provider would.
private final class MinimalClient: AnalyticsClient, @unchecked Sendable {
    private let lock = NSLock()
    private var recorded: [String] = []
    var events: [String] { lock.withLock { recorded } }

    func track(_ event: AnalyticsEvent) { lock.withLock { recorded.append(event.name) } }
    func setUserID(_ userID: String?) { lock.withLock { recorded.append("user:\(userID ?? "nil")") } }
    func recordError(_ error: Error, context: [String: String]) {
        lock.withLock { recorded.append("error:\(context["screen"] ?? "-")") }
    }
}

@Suite("Analytics contract")
struct AnalyticsContractTests {
    @Test("addBreadcrumb has a no-op default, so providers without breadcrumbs still conform")
    func breadcrumbDefault() {
        let client = MinimalClient()

        client.addBreadcrumb("opened settings", category: "navigation")

        #expect(client.events.isEmpty)
    }

    @Test("the protocol is usable through an existential, the way features hold it")
    func existential() {
        let client: any AnalyticsClient = MinimalClient()

        client.track(AnalyticsEvent(name: "task_created"))
        client.setUserID(nil)
        client.recordError(URLError(.timedOut), context: ["screen": "tasks"])

        let recorded = (client as? MinimalClient)?.events
        #expect(recorded == ["task_created", "user:nil", "error:tasks"])
    }

    @Test("an event without parameters has an empty parameter map")
    func eventDefaults() {
        #expect(AnalyticsEvent(name: "x").parameters.isEmpty)
        #expect(AnalyticsEvent(name: "x", parameters: ["k": "v"]).parameters == ["k": "v"])
    }

    @Test("consent has stable raw values (persisted and sent to the provider)")
    func consentRawValues() {
        #expect(AnalyticsConsent.unknown.rawValue == "unknown")
        #expect(AnalyticsConsent.granted.rawValue == "granted")
        #expect(AnalyticsConsent.denied.rawValue == "denied")
        #expect(AnalyticsConsent(rawValue: "granted") == .granted)
        #expect(AnalyticsConsent(rawValue: "yes") == nil)
    }
}

@Suite("StaticFeatureFlags")
struct StaticFeatureFlagsTests {
    @Test("an unknown flag returns the caller's default, either way")
    func unknownFlag() {
        let flags = StaticFeatureFlags()

        #expect(flags.isEnabled("new_ui", default: false) == false)
        #expect(flags.isEnabled("new_ui", default: true) == true)
    }

    @Test("an override wins over the caller's default, including an explicit off")
    func overrides() {
        let flags = StaticFeatureFlags(["on_flag": true, "off_flag": false])

        #expect(flags.isEnabled("on_flag", default: false))
        #expect(!flags.isEnabled("off_flag", default: true))
    }

    @Test("it satisfies FeatureFlagProvider for injection")
    func provider() {
        let provider: any FeatureFlagProvider = StaticFeatureFlags(["x": true])

        #expect(provider.isEnabled("x", default: false))
    }
}

@Suite("DiagnosticCounts (more)")
struct DiagnosticCountsMoreTests {
    @Test("all-zero counts still produce all four keys")
    func zeros() {
        let counts = DiagnosticCounts(crashes: 0, hangs: 0, cpuExceptions: 0, diskWriteExceptions: 0)

        #expect(Set(counts.parameters.keys) == ["crashes", "hangs", "cpu_exceptions", "disk_write_exceptions"])
        #expect(counts.parameters.values.allSatisfy { $0 == "0" })
    }

    @Test("counts are value-equal")
    func equality() {
        let a = DiagnosticCounts(crashes: 1, hangs: 2, cpuExceptions: 3, diskWriteExceptions: 4)

        #expect(a == DiagnosticCounts(crashes: 1, hangs: 2, cpuExceptions: 3, diskWriteExceptions: 4))
        #expect(a != DiagnosticCounts(crashes: 1, hangs: 2, cpuExceptions: 3, diskWriteExceptions: 5))
    }
}
