#if os(iOS) || os(macOS) || os(visionOS)
import Testing
@testable import AedstDesignSystem

@Suite("AedstDataTable")
struct AedstDataTableTests {
    @Test("a header tap cycles ascending, descending, unsorted")
    func sortCycle() {
        let ascending = AedstDataTableSort.next(after: nil, columnID: "name")
        #expect(ascending == AedstDataTableSort(columnID: "name", isAscending: true))
        let descending = AedstDataTableSort.next(after: ascending, columnID: "name")
        #expect(descending == AedstDataTableSort(columnID: "name", isAscending: false))
        #expect(AedstDataTableSort.next(after: descending, columnID: "name") == nil)
    }

    @Test("tapping another column starts ascending on it")
    func sortSwitchesColumn() {
        let current = AedstDataTableSort(columnID: "name", isAscending: false)
        #expect(AedstDataTableSort.next(after: current, columnID: "date") == AedstDataTableSort(columnID: "date"))
    }

    @Test("select all selects the visible rows and keeps rows of other pages")
    func selectAll() {
        let selection: Set<String> = ["other-page"]
        let all = AedstDataTableSelection.togglingAll(selection, visible: ["a", "b"])
        #expect(all == ["other-page", "a", "b"])
        #expect(AedstDataTableSelection.isAllSelected(all, visible: ["a", "b"]))
        #expect(AedstDataTableSelection.togglingAll(all, visible: ["a", "b"]) == ["other-page"])
    }

    @Test("an empty page is never all selected")
    func emptyIsNotAllSelected() {
        let selection: Set<String> = ["a"]
        #expect(!AedstDataTableSelection.isAllSelected(selection, visible: []))
    }

    @Test("a row checkbox toggles one id")
    func toggleRow() {
        let selected = AedstDataTableSelection.toggling(Set<String>(), id: "a")
        #expect(selected == ["a"])
        #expect(AedstDataTableSelection.toggling(selected, id: "a").isEmpty)
    }
}
#endif
