// The component exists on iOS, macOS and visionOS only (see AedstAiTask.swift).
#if os(iOS) || os(macOS) || os(visionOS)
import Testing
@testable import AedstDesignSystem

@Suite("AedstAiTask")
struct AedstAiTaskTests {
    @Test("a running task line spins, a failed one shows the cross, a done one has no status icon")
    func lineStatus() {
        #expect(AedstAiLineLogic.leadingSymbol(status: .running, systemImage: nil) == .status(.running))
        #expect(AedstAiLineLogic.leadingSymbol(status: .error, systemImage: nil) == .status(.error))
        #expect(AedstAiLineLogic.leadingSymbol(status: nil, systemImage: nil) == nil)
    }

    @Test("the spoken task line carries the status in words")
    func spoken() {
        #expect(AedstAiLineLogic.spokenLabel(title: "Searching", statusLabel: "Running", description: nil) == "Searching, Running")
    }

    @Test("the task, its items and file chips build")
    @MainActor
    func builds() {
        _ = AedstAiTask("Found 3 files", description: "1 s") {
            AedstAiTaskItem("Searched")
            AedstAiTaskItem("Read") { AedstAiTaskItemFile("ui/button.tsx") }
        }
        _ = AedstAiTaskTrigger("Searching", status: .running, statusLabel: "Running")
    }
}
#endif
