// The component exists on iOS, macOS and visionOS only (see AedstAiTool.swift).
#if os(iOS) || os(macOS) || os(visionOS)
import Testing
@testable import AedstDesignSystem

@Suite("AedstAiTool")
struct AedstAiToolTests {
    @Test("every tool state maps to the web line status")
    func states() {
        let expected: [AedstAiToolState: AedstTraceStatus] = [
            .inputStreaming: .running,
            .inputAvailable: .running,
            .approvalRequested: .pending,
            .approvalResponded: .running,
            .outputAvailable: .success,
            .outputError: .error,
            .outputDenied: .skipped,
        ]
        for state in AedstAiToolState.allCases {
            #expect(state.status == expected[state])
        }
    }

    @Test("arguments are formatted as indented JSON with sorted keys and plain slashes")
    func json() {
        struct Arguments: Encodable { let path: String; let all: Bool }
        let text = AedstAiToolFormatting.json(Arguments(path: "src/ui", all: true))
        #expect(text == "{\n  \"all\" : true,\n  \"path\" : \"src/ui\"\n}")
    }

    @Test("the tool, its sections and the approval build")
    @MainActor
    func builds() {
        _ = AedstAiTool("Ran ls", state: .outputAvailable) {
            AedstAiToolInput(label: "Parameters", input: "{}")
            AedstAiToolOutput(label: "Result", output: "a.txt")
            AedstAiToolOutput(label: "Result", errorText: "ENOENT")
        }
        _ = AedstAiToolHeader("Running ls", state: .inputStreaming)
        _ = AedstAiToolApproval("Run ls?", approveLabel: "Approve", denyLabel: "Deny", onApprove: {}, onDeny: {})
    }
}
#endif
