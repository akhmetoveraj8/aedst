// The component exists on iOS, macOS and visionOS only (see AedstAiTerminal.swift).
#if os(iOS) || os(macOS) || os(visionOS)
import Testing
@testable import AedstDesignSystem

@Suite("AedstAiTerminal")
struct AedstAiTerminalTests {
    @Test("uncontrolled, it opens once output arrives while running")
    func opensWithOutput() {
        #expect(!AedstAiTerminalLogic.isOpen(controlled: nil, userChoice: nil, isStreaming: true, output: ""))
        #expect(AedstAiTerminalLogic.isOpen(controlled: nil, userChoice: nil, isStreaming: true, output: "> build"))
        #expect(!AedstAiTerminalLogic.isOpen(controlled: nil, userChoice: nil, isStreaming: false, output: "done"))
    }

    @Test("the user's choice and the controlled state win over the automatic behaviour")
    func choiceWins() {
        #expect(!AedstAiTerminalLogic.isOpen(controlled: nil, userChoice: false, isStreaming: true, output: "x"))
        #expect(AedstAiTerminalLogic.isOpen(controlled: true, userChoice: false, isStreaming: false, output: ""))
    }

    @Test("the line spins while running unless the caller gives a status")
    func status() {
        #expect(AedstAiTerminalLogic.status(explicit: nil, isStreaming: true) == .running)
        #expect(AedstAiTerminalLogic.status(explicit: nil, isStreaming: false) == nil)
        #expect(AedstAiTerminalLogic.status(explicit: .error, isStreaming: true) == .error)
    }

    @Test("it follows the output only while streaming with auto-scroll on")
    func followsOutput() {
        #expect(AedstAiTerminalLogic.followsOutput(autoScroll: true, isStreaming: true))
        #expect(!AedstAiTerminalLogic.followsOutput(autoScroll: false, isStreaming: true))
        #expect(!AedstAiTerminalLogic.followsOutput(autoScroll: true, isStreaming: false))
    }

    @Test("the output viewport grows with the content up to the cap")
    func visibleHeight() {
        #expect(AedstAiTerminalLogic.visibleHeight(content: 0, cap: 256) == AedstSpacing.xxxl)
        #expect(AedstAiTerminalLogic.visibleHeight(content: 100, cap: 256) == 100)
        #expect(AedstAiTerminalLogic.visibleHeight(content: 900, cap: 256) == 256)
    }

    @Test("the terminal and its parts build")
    @MainActor
    func builds() {
        _ = AedstAiTerminal("Running pnpm build", output: "> next build", isStreaming: true, clearLabel: "Clear output", onClear: {})
        _ = AedstAiTerminalTitle("Ran pnpm build")
        _ = AedstAiTerminalClearButton(label: "Clear output", isDisabled: true) {}
        _ = AedstAiTerminalContent(output: "")
    }
}
#endif
