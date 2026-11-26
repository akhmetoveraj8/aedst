// The component exists on iOS, macOS and visionOS only (see AedstAiPlan.swift).
#if os(iOS) || os(macOS) || os(visionOS)
import SwiftUI
import Testing
@testable import AedstDesignSystem

@Suite("AedstAiPlan")
struct AedstAiPlanTests {
    @Test("a streaming plan line shows the spinner even with its route icon")
    func streamingSpins() {
        let symbol = AedstAiLineLogic.leadingSymbol(status: .running, systemImage: "point.topleft.down.curvedto.point.bottomright.up")
        #expect(symbol == .status(.running))
    }

    @Test("a finished plan line keeps its icon")
    func finishedKeepsIcon() {
        #expect(AedstAiLineLogic.leadingSymbol(status: nil, systemImage: "map") == .icon("map"))
    }

    @Test("the plan and its parts build, with and without actions")
    @MainActor
    func builds() {
        _ = AedstAiPlan("Rename", description: "1 of 2 done", isStreaming: true) {
            AedstAiPlanDescription("Move, then test.")
            AedstAiPlanSteps {
                AedstAiPlanStep("Move")
                AedstAiPlanStep("Test", status: .pending, statusLabel: "Pending")
            }
            AedstAiPlanFooter { EmptyView() }
        }
        _ = AedstAiPlan("Rename") {
            AedstIconButton(systemImage: "doc.on.doc", accessibilityLabel: "Copy") {}
        } content: {
            EmptyView()
        }
        _ = AedstAiPlanTrigger("Rename")
        _ = AedstAiPlanAction { EmptyView() }
    }
}
#endif
