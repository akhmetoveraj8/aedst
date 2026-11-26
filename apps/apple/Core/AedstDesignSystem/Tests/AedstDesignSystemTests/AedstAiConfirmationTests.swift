#if os(iOS) || os(macOS) || os(visionOS)
import SwiftUI
import Testing
@testable import AedstDesignSystem

@Suite("AedstAiConfirmation")
struct AedstAiConfirmationTests {
    private let pending = AedstAiConfirmationApproval(id: "1")
    private let yes = AedstAiConfirmationApproval(id: "1", approved: true)
    private let no = AedstAiConfirmationApproval(id: "1", approved: false, reason: "Too risky")

    @Test("a requested approval is pending whatever the answer field says")
    func pendingPhase() {
        #expect(AedstAiConfirmationPhase(state: .approvalRequested, approval: pending) == .pending)
        #expect(AedstAiConfirmationPhase(state: .approvalRequested, approval: yes) == .pending)
    }

    @Test("an answered approval is accepted or rejected by the answer")
    func answeredPhases() {
        #expect(AedstAiConfirmationPhase(state: .approvalResponded, approval: yes) == .accepted)
        #expect(AedstAiConfirmationPhase(state: .outputAvailable, approval: yes) == .accepted)
        #expect(AedstAiConfirmationPhase(state: .approvalResponded, approval: no) == .rejected)
        #expect(AedstAiConfirmationPhase(state: .approvalResponded, approval: pending) == .answered)
    }

    @Test("a denied output is rejected even without an answer")
    func deniedOutput() {
        #expect(AedstAiConfirmationPhase(state: .outputDenied, approval: pending) == .rejected)
    }

    @Test("parts outside a confirmation see the pending phase")
    func defaultPhase() {
        #expect(EnvironmentValues().aedstAiConfirmationPhase == .pending)
    }
}
#endif
