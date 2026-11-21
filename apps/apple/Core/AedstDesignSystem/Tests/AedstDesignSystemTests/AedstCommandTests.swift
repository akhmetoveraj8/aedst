// Same platforms as the component (see AedstCommand.swift).
#if os(iOS) || os(macOS) || os(visionOS)
import Testing
@testable import AedstDesignSystem

@MainActor
@Suite("AedstCommand")
struct AedstCommandTests {
    private var groups: [AedstCommandGroup] {
        [
            AedstCommandGroup("Suggestions", items: [
                AedstCommandItem("Calendar") {},
                AedstCommandItem("Search tasks", keywords: ["find"]) {},
            ]),
            AedstCommandGroup("Settings", items: [
                AedstCommandItem("Profile") {},
                AedstCommandItem("Billing") {},
            ]),
        ]
    }

    private func titles(_ groups: [AedstCommandGroup]) -> [String] {
        groups.flatMap(\.items).map(\.title)
    }

    @Test("a blank query keeps every group and entry")
    func blankQueryKeepsEverything() {
        #expect(titles(AedstCommand.filter(groups, query: "")) == ["Calendar", "Search tasks", "Profile", "Billing"])
        #expect(titles(AedstCommand.filter(groups, query: "  \n")).count == 4)
    }

    @Test("the query matches titles without regard to case and drops empty groups")
    func matchesTitles() {
        let result = AedstCommand.filter(groups, query: "PRO")
        #expect(titles(result) == ["Profile"])
        #expect(result.map(\.id) == ["Settings"])
    }

    @Test("the query matches keywords")
    func matchesKeywords() {
        #expect(titles(AedstCommand.filter(groups, query: "find")) == ["Search tasks"])
    }

    @Test("nothing matching yields no groups")
    func noMatches() {
        #expect(AedstCommand.filter(groups, query: "zzz").isEmpty)
    }

    @Test("the highlight starts at an end, moves by the offset and stops at the ends")
    func highlightMoves() {
        let ids = ["a", "b", "c"]
        #expect(AedstCommand.highlight(after: nil, in: ids, offset: 1) == "a")
        #expect(AedstCommand.highlight(after: nil, in: ids, offset: -1) == "c")
        #expect(AedstCommand.highlight(after: "a", in: ids, offset: 1) == "b")
        #expect(AedstCommand.highlight(after: "c", in: ids, offset: 1) == "c")
        #expect(AedstCommand.highlight(after: "a", in: ids, offset: -1) == "a")
        #expect(AedstCommand.highlight(after: "gone", in: ids, offset: 1) == "a")
        #expect(AedstCommand.highlight(after: "a", in: [], offset: 1) == nil)
    }
}
#endif
