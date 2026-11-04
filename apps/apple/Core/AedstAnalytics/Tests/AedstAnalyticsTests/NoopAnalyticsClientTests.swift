import Foundation
import Testing
@testable import AedstAnalytics

@Suite("NoopAnalyticsClient")
struct NoopAnalyticsClientTests {
    @Test("does not throw or crash on any call")
    func doesNotCrash() {
        let client = NoopAnalyticsClient()
        client.track(AnalyticsEvent(name: "test_event", parameters: ["k": "v"]))
        client.setUserID("user-1")
        client.setUserID(nil)
        client.recordError(URLError(.notConnectedToInternet), context: [:])
    }
}
