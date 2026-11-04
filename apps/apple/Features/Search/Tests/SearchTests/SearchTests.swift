import AedstCore
import AedstTesting
import Foundation
import Testing
@testable import Search

actor RecordingSearchRepository: SearchRepository {
    private(set) var queries: [String] = []

    func search(query: String, pageToken: String?) async -> Outcome<Page<SearchHit>> {
        queries.append(query)
        let hit = SearchHit(kind: .task, id: query, title: query, snippet: "\u{E000}\(query)\u{E001}", link: "/tasks/\(query)")
        return .success(Page(items: [hit], nextPageToken: nil))
    }
}

@Suite("SnippetHighlighter")
struct SnippetHighlighterTests {
    @Test("marked runs are strongly emphasized, markers are removed")
    func highlights() {
        let attributed = SnippetHighlighter.attributedString(from: "buy \u{E000}milk\u{E001} today")
        #expect(String(attributed.characters) == "buy milk today")
        let emphasized = attributed.runs
            .filter { $0.inlinePresentationIntent == .stronglyEmphasized }
            .map { String(attributed[$0.range].characters) }
        #expect(emphasized == ["milk"])
    }

    @Test("stray and unbalanced markers never leak")
    func strayMarkers() {
        let attributed = SnippetHighlighter.attributedString(from: "\u{E001}a\u{E000}b")
        #expect(String(attributed.characters) == "ab")
        #expect(SnippetHighlighter.plainText(from: "x\u{E000}y\u{E001}") == "xy")
    }
}

@Suite("SearchViewModel")
@MainActor
struct SearchViewModelTests {
    @Test("only the last query of a burst is sent, after the debounce")
    func debounces() async {
        let repository = RecordingSearchRepository()
        let clock = ManualClock()
        let model = SearchViewModel(repository: repository, clock: clock)

        model.query = "m"
        model.query = "mi"
        model.query = "milk"
        await model.waitForPendingSearch()

        #expect(await repository.queries == ["milk"])
        #expect(model.hits.map(\.id) == ["milk"])
        #expect(clock.sleptDurations.contains(SearchViewModel.debounce))
    }

    @Test("clearing the query clears results without a request")
    func clears() async {
        let repository = RecordingSearchRepository()
        let model = SearchViewModel(repository: repository, clock: ManualClock())
        model.query = "  "
        await model.waitForPendingSearch()
        #expect(await repository.queries.isEmpty)
        #expect(model.hits.isEmpty)
    }
}
