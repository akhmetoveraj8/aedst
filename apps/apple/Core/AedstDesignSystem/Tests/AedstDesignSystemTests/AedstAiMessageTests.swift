#if os(iOS) || os(macOS) || os(visionOS)
import SwiftUI
import Testing
@testable import AedstDesignSystem

@Suite("AedstAiMessage")
struct AedstAiMessageTests {
    @Test("the person's turn sits at the end; the agent's and the system's at the start")
    func alignmentByRole() {
        #expect(AedstAiMessageRole.user.align == .end)
        #expect(AedstAiMessageRole.assistant.align == .start)
        #expect(AedstAiMessageRole.system.align == .start)
    }

    @Test("outside a message, content renders as the agent's turn")
    func defaultRole() {
        #expect(EnvironmentValues().aedstAiMessageRole == .assistant)
    }

    @Test("the reply is verbatim unless Markdown is asked for")
    func markdownOptIn() {
        let plain = AedstAiMessageResponse.content("**bold**", rendersMarkdown: false)
        #expect(String(plain.characters) == "**bold**")
        let parsed = AedstAiMessageResponse.content("**bold** text", rendersMarkdown: true)
        #expect(String(parsed.characters) == "bold text")
    }

    @Test("line breaks survive Markdown parsing")
    func markdownKeepsWhitespace() {
        let parsed = AedstAiMessageResponse.content("one\ntwo", rendersMarkdown: true)
        #expect(String(parsed.characters) == "one\ntwo")
    }

    @Test("a reply that did not change is equal, so SwiftUI can skip it")
    @MainActor
    func responseEquality() {
        #expect(AedstAiMessageResponse("a", streaming: true) == AedstAiMessageResponse("a", streaming: true))
        #expect(AedstAiMessageResponse("a", streaming: true) != AedstAiMessageResponse("a", streaming: false))
    }
}
#endif
