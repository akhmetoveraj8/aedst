// The component exists on iOS, macOS and visionOS only (see AedstAiReasoning.swift).
#if os(iOS) || os(macOS) || os(visionOS)
import Testing
@testable import AedstDesignSystem

@Suite("AedstAiReasoning")
struct AedstAiReasoningTests {
    @Test("it follows streaming until the user or the caller decides")
    func openState() {
        #expect(AedstAiReasoningLogic.isOpen(controlled: nil, userChoice: nil, isStreaming: true))
        #expect(!AedstAiReasoningLogic.isOpen(controlled: nil, userChoice: nil, isStreaming: false))
        #expect(AedstAiReasoningLogic.isOpen(controlled: nil, userChoice: true, isStreaming: false))
        #expect(!AedstAiReasoningLogic.isOpen(controlled: nil, userChoice: false, isStreaming: true))
        #expect(!AedstAiReasoningLogic.isOpen(controlled: false, userChoice: true, isStreaming: true))
    }

    @Test("the title switches from thinking to thought")
    func title() {
        #expect(AedstAiReasoningLogic.title(isStreaming: true, thinkingLabel: "Thinking", thoughtLabel: "Thought") == "Thinking")
        #expect(AedstAiReasoningLogic.title(isStreaming: false, thinkingLabel: "Thinking", thoughtLabel: "Thought") == "Thought")
    }

    @Test("only a change of streaming is announced, never the first render")
    func announcement() {
        func say(_ was: Bool?, _ now: Bool) -> String? {
            AedstAiReasoningLogic.announcement(wasStreaming: was, isStreaming: now, thinkingLabel: "Thinking", thoughtLabel: "Thought")
        }
        #expect(say(nil, true) == nil)
        #expect(say(true, true) == nil)
        #expect(say(true, false) == "Thought")
        #expect(say(false, true) == "Thinking")
    }

    @Test("it builds from text")
    @MainActor
    func builds() {
        _ = AedstAiReasoning("Step one", isStreaming: true, thinkingLabel: "Thinking", thoughtLabel: "Thought")
        _ = AedstAiReasoningTrigger(isStreaming: false, thinkingLabel: "Thinking", thoughtLabel: "Thought")
        _ = AedstAiReasoningContent("Step one")
    }
}
#endif
