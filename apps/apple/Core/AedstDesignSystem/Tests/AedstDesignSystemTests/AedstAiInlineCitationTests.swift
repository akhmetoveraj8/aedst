#if os(iOS) || os(macOS) || os(visionOS)
import SwiftUI
import Testing
@testable import AedstDesignSystem

@Suite("AedstAiInlineCitation")
@MainActor
struct AedstAiInlineCitationTests {
    @Test("the host drops www.; a string that is not a URL is returned as is")
    func hostname() {
        #expect(AedstAiCitation.hostname("https://www.swift.org/blog") == "swift.org")
        #expect(AedstAiCitation.hostname("https://developer.apple.com") == "developer.apple.com")
        #expect(AedstAiCitation.hostname("not a url") == "not a url")
    }

    @Test("the chip shows the first host and counts the others")
    func triggerParts() {
        let parts = AedstAiCitation.triggerParts(["https://a.com", "https://b.com", "https://c.com"])
        #expect(parts.host == "a.com")
        #expect(parts.more == 2)
        let none = AedstAiCitation.triggerParts([])
        #expect(none.host == nil)
        #expect(none.more == 0)
    }

    @Test("VoiceOver hears the more label instead of +N when one is given")
    func spokenLabel() {
        typealias Card = AedstAiInlineCitationCard<EmptyView>
        #expect(Card.spokenLabel(host: "a.com", more: 0, moreLabel: "and 2 more") == "a.com")
        #expect(Card.spokenLabel(host: "a.com", more: 2, moreLabel: "and 2 more") == "a.com and 2 more")
        #expect(Card.spokenLabel(host: "a.com", more: 2, moreLabel: nil) == "a.com +2")
    }
}
#endif
