import AedstCore
import Testing
@testable import AedstDesignSystem

@Suite("AedstErrorPresentation")
struct AedstErrorPresentationTests {
    @Test("a cancelled operation is silent: no alert, no toast")
    func cancelledIsSilent() {
        #expect(AedstError.cancelled.presentation == .silent)
    }

    @Test("transient failures are toasts, actionable ones alerts")
    func toastsAndAlerts() {
        #expect(AedstError.offline.presentation == .toast)
        #expect(AedstError.timeout.presentation == .toast)
        #expect(AedstError.rateLimited(retryAfter: nil).presentation == .toast)
        #expect(AedstError.forbidden.presentation == .alert)
        #expect(AedstError.unknown(reason: "x").presentation == .alert)
    }
}
