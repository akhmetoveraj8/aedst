// Same platforms as the component (see AedstCombobox.swift).
#if os(iOS) || os(macOS) || os(visionOS)
import Testing
@testable import AedstDesignSystem

@MainActor
@Suite("AedstCombobox")
struct AedstComboboxTests {
    private let options = [
        AedstSelectOption(id: "swiftui", title: "SwiftUI"),
        AedstSelectOption(id: "compose", title: "Jetpack Compose"),
        AedstSelectOption(id: "react", title: "React"),
    ]

    @Test("a blank query keeps every option in order")
    func blankQueryKeepsEverything() {
        #expect(AedstCombobox.filter(options, query: "") == options)
        #expect(AedstCombobox.filter(options, query: "   ") == options)
    }

    @Test("the query matches inside the title without regard to case")
    func matchesInsideTitle() {
        #expect(AedstCombobox.filter(options, query: "comp").map(\.id) == ["compose"])
        #expect(AedstCombobox.filter(options, query: "SWIFT").map(\.id) == ["swiftui"])
    }

    @Test("nothing matching yields an empty list")
    func noMatches() {
        #expect(AedstCombobox.filter(options, query: "zzz").isEmpty)
    }
}
#endif
