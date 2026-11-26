// The component exists on iOS, macOS and visionOS only (see AedstAiCheckpoint.swift).
#if os(iOS) || os(macOS) || os(visionOS)
import Testing
@testable import AedstDesignSystem

@Suite("AedstAiCheckpoint")
struct AedstAiCheckpointTests {
    @Test("the explicit hint wins over the tooltip, which is the fallback hint")
    func hint() {
        #expect(AedstAiCheckpointLogic.hint(accessibilityHint: "Restores to Button renamed", tooltip: "Restore") == "Restores to Button renamed")
        #expect(AedstAiCheckpointLogic.hint(accessibilityHint: nil, tooltip: "Restore the thread") == "Restore the thread")
        #expect(AedstAiCheckpointLogic.hint(accessibilityHint: nil, tooltip: nil).isEmpty)
    }

    @Test("the checkpoint builds with and without a label")
    @MainActor
    func builds() {
        _ = AedstAiCheckpoint("Button renamed") {
            AedstAiCheckpointTrigger("Restore", tooltip: "Restore the thread to this point") {}
        }
        _ = AedstAiCheckpoint {
            AedstAiCheckpointTrigger("Restore", accessibilityHint: "Restores to the first answer") {}
        }
    }
}
#endif
