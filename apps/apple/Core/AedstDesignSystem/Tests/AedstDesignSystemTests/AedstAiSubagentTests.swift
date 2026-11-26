// The component exists on iOS, macOS and visionOS only (see AedstAiSubagent.swift).
#if os(iOS) || os(macOS) || os(visionOS)
import Testing
@testable import AedstDesignSystem

@Suite("AedstAiSubagent")
struct AedstAiSubagentTests {
    @Test("a working subagent spins instead of the bot icon, a finished one keeps it")
    func lineStatus() {
        #expect(AedstAiLineLogic.leadingSymbol(status: .running, systemImage: "cpu") == .status(.running))
        #expect(AedstAiLineLogic.leadingSymbol(status: nil, systemImage: "cpu") == .icon("cpu"))
    }

    @Test("the subagent with task, meta rows and steps builds")
    @MainActor
    func builds() {
        _ = AedstAiSubagent("Ran the research agent", description: "12 s") {
            AedstAiSubagentTask("Find every use of the button.")
            AedstAiSubagentMeta {
                AedstAiSubagentModel(label: "Model", model: "gpt-5-mini")
                AedstAiSubagentTools(label: "Tools", tools: ["grep", "read_file"])
            }
            AedstAiSubagentSteps {
                AedstAiSubagentStep("grep", description: "14 matches")
            }
        }
        _ = AedstAiSubagentTrigger("Running the research agent", status: .running, statusLabel: "Running")
    }
}
#endif
