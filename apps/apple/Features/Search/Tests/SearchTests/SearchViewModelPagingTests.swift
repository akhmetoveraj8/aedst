import AedstAnalytics
import AedstCore
import AedstTesting
import Foundation
import Testing
@testable import Search

private final class RecordingAnalytics: AnalyticsClient, @unchecked Sendable {
    private let lock = NSLock()
    private var recorded: [AnalyticsEvent] = []
    var events: [AnalyticsEvent] { lock.withLock { recorded } }

    func track(_ event: AnalyticsEvent) { lock.withLock { recorded.append(event) } }
    func setUserID(_ userID: String?) {}
    func recordError(_ error: Error, context: [String: String]) {}
}

/// Answers by page token; a missing token is an offline error.
private actor PagedSearchRepository: SearchRepository {
    private var pages: [String?: Page<SearchHit>] = [:]
    private(set) var calls: [String] = []

    func script(_ page: Page<SearchHit>, token: String?) { pages[token] = page }

    func search(query: String, pageToken: String?) async -> Outcome<Page<SearchHit>> {
        calls.append("\(query)|\(pageToken ?? "-")")
        return pages[pageToken].map { .success($0) } ?? .failure(.unavailable(reason: "offline"))
    }
}

private func hit(_ id: String) -> SearchHit {
    SearchHit(kind: .task, id: id, title: id, snippet: id, link: "/tasks/\(id)")
}

@Suite("SearchViewModel (paging, errors, analytics)")
@MainActor
struct SearchViewModelPagingTests {
    @Test("the next page is appended when the last hit is reached, and the first page is replaced on a new query")
    func pages() async {
        let repository = PagedSearchRepository()
        await repository.script(Page(items: [hit("1"), hit("2")], nextPageToken: "p2"), token: nil)
        await repository.script(Page(items: [hit("3")], nextPageToken: nil), token: "p2")
        let model = SearchViewModel(repository: repository, clock: ManualClock())

        model.query = "milk"
        await model.waitForPendingSearch()
        await model.loadMoreIfNeeded(after: model.hits[0]) // not the last hit
        #expect(model.hits.map(\.id) == ["1", "2"])

        await model.loadMoreIfNeeded(after: model.hits[1])
        #expect(model.hits.map(\.id) == ["1", "2", "3"])
        #expect(await repository.calls == ["milk|-", "milk|p2"])

        await repository.script(Page(items: [hit("9")], nextPageToken: nil), token: nil)
        model.query = "bread"
        await model.waitForPendingSearch()
        #expect(model.hits.map(\.id) == ["9"])
    }

    @Test("a failing search reports the error and does not claim results")
    func failure() async {
        let model = SearchViewModel(repository: PagedSearchRepository(), clock: ManualClock())

        model.query = "milk"
        await model.waitForPendingSearch()

        #expect(model.error == .unavailable(reason: "offline"))
        #expect(model.hits.isEmpty)
        #expect(!model.hasResults)
    }

    @Test("clearing the query after results resets the state")
    func clearingResets() async {
        let repository = PagedSearchRepository()
        await repository.script(Page(items: [hit("1")], nextPageToken: "p2"), token: nil)
        let model = SearchViewModel(repository: repository, clock: ManualClock())
        model.query = "milk"
        await model.waitForPendingSearch()
        #expect(model.hasResults)

        model.query = ""

        #expect(model.hits.isEmpty)
        #expect(!model.hasResults)
        #expect(!model.isSearching)
    }

    @Test("only the first page is tracked, with the result count")
    func tracksFirstPageOnly() async {
        let repository = PagedSearchRepository()
        await repository.script(Page(items: [hit("1"), hit("2")], nextPageToken: "p2"), token: nil)
        await repository.script(Page(items: [hit("3")], nextPageToken: nil), token: "p2")
        let analytics = RecordingAnalytics()
        let model = SearchViewModel(repository: repository, clock: ManualClock(), analytics: analytics)

        model.query = "milk"
        await model.waitForPendingSearch()
        await model.loadMoreIfNeeded(after: model.hits[1])

        #expect(analytics.events.map(\.name) == ["search_performed"])
        #expect(analytics.events.first?.parameters == ["results": "2"])
    }

    @Test("the query is trimmed and cut to the server's 200 character limit")
    func normalizesQuery() async {
        let repository = PagedSearchRepository()
        await repository.script(Page(items: [], nextPageToken: nil), token: nil)
        let model = SearchViewModel(repository: repository, clock: ManualClock())

        model.query = "  " + String(repeating: "a", count: 250) + "  "
        await model.waitForPendingSearch()

        let calls = await repository.calls
        #expect(calls == [String(repeating: "a", count: SearchViewModel.maxQueryLength) + "|-"])
    }
}

@Suite("SearchHit")
struct SearchHitTests {
    @Test("an empty snippet highlights to an empty string")
    func emptySnippet() {
        #expect(String(SnippetHighlighter.attributedString(from: "").characters).isEmpty)
        #expect(SnippetHighlighter.plainText(from: "").isEmpty)
    }

    @Test("adjacent highlighted runs stay separate runs")
    func adjacentRuns() {
        let attributed = SnippetHighlighter.attributedString(from: "\u{E000}a\u{E001}b\u{E000}c\u{E001}")
        let emphasized = attributed.runs
            .filter { $0.inlinePresentationIntent == .stronglyEmphasized }
            .map { String(attributed[$0.range].characters) }

        #expect(String(attributed.characters) == "abc")
        #expect(emphasized == ["a", "c"])
    }
}
