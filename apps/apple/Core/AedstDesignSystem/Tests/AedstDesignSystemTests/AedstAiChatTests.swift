#if os(iOS) || os(macOS) || os(visionOS)
import SwiftUI
import Testing
@testable import AedstDesignSystem

@Suite("AedstAiChat")
struct AedstAiChatTests {
    @Test("only the person's turns slide in, and never with Reduce Motion on")
    func slideIn() {
        #expect(AedstAiChatPolicy.slidesIn(.user, reduceMotion: false))
        #expect(!AedstAiChatPolicy.slidesIn(.user, reduceMotion: true))
        #expect(!AedstAiChatPolicy.slidesIn(.assistant, reduceMotion: false))
        #expect(!AedstAiChatPolicy.slidesIn(.system, reduceMotion: false))
    }

    @Test("a finished reply is announced; a streaming one waits (busy is aria-busy)")
    func busyHoldsAnnouncements() {
        let streaming = AedstMessageScrollerPolicy.announcement(
            previousLastID: 1, lastID: 2, isStreaming: true, isAtEnd: true, text: "Reply"
        )
        #expect(streaming == nil)
        let done = AedstMessageScrollerPolicy.announcement(
            previousLastID: 1, lastID: 2, isStreaming: false, isAtEnd: true, text: "Reply"
        )
        #expect(done == "Reply")
    }

    @Test("the thread and its empty state build from the kit parts")
    @MainActor
    func builds() {
        let chat = AedstAiChat([AedstAiChatTestTurn(id: 1)], busy: true, scrollToEndLabel: "Latest") { _ in
            AedstAiChatItem(from: .user) { EmptyView() }
        }
        _ = chat.body
        _ = AedstAiChatEmptyState("Start", description: "Ask anything", systemImage: "sparkles").body
    }
}

private struct AedstAiChatTestTurn: Identifiable {
    let id: Int
}
#endif
