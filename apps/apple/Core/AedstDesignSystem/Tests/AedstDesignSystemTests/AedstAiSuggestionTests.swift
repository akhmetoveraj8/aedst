#if os(iOS) || os(macOS) || os(visionOS)
import SwiftUI
import Testing
@testable import AedstDesignSystem

@Suite("AedstAiSuggestion")
@MainActor
struct AedstAiSuggestionTests {
    @Test("the suggestion is the title unless a shorter title is given")
    func title() {
        #expect(AedstAiSuggestion("Summarise my week") { _ in }.displayTitle == "Summarise my week")
        #expect(AedstAiSuggestion("Summarise my week in three bullets", title: "Summarise") { _ in }.displayTitle == "Summarise")
    }

    @Test("the row of suggestions builds from the kit button")
    func builds() {
        _ = AedstAiSuggestions(accessibilityLabel: "Suggestions") {
            AedstAiSuggestion("Hello") { _ in }
        }.body
    }
}
#endif
