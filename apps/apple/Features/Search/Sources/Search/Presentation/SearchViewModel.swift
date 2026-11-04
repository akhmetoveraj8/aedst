import AedstAnalytics
import AedstCore
import Foundation
import Observation

/// Search-as-you-type. Every keystroke cancels the pending request and starts
/// a new debounce (`Task` + the injected `AedstClock.sleep`, so tests control
/// time). Stale responses are dropped
/// by comparing against the query they were issued for.
@MainActor
@Observable
public final class SearchViewModel {
    /// Debounce interval in seconds.
    public static let debounce: TimeInterval = 0.3
    /// Same bounds as `SearchRequest.query` (min_len 1, max_len 200).
    public static let maxQueryLength = 200

    public var query = "" {
        didSet { if query != oldValue { scheduleSearch() } }
    }
    public private(set) var hits: [SearchHit] = []
    public private(set) var isSearching = false
    /// `true` once a search for the current query finished (drives the "no results" state).
    public private(set) var hasResults = false
    /// Bound to `aedstErrorPresenter`.
    public var error: AedstError?

    @ObservationIgnored private var nextPageToken: String?
    @ObservationIgnored private var pending: Task<Void, Never>?
    private let repository: any SearchRepository
    private let clock: any AedstClock
    private let analytics: AnalyticsClient

    /// `clock` is injectable so tests skip the real debounce.
    public init(
        repository: any SearchRepository,
        clock: any AedstClock = SystemClock(),
        analytics: AnalyticsClient = NoopAnalyticsClient()
    ) {
        self.repository = repository
        self.clock = clock
        self.analytics = analytics
    }

    /// The trimmed query that will be sent (empty means "no search").
    var normalizedQuery: String {
        String(query.trimmingCharacters(in: .whitespacesAndNewlines).prefix(Self.maxQueryLength))
    }

    /// Loads the next page when `hit` is the last row shown.
    public func loadMoreIfNeeded(after hit: SearchHit) async {
        guard hit.id == hits.last?.id, let token = nextPageToken, !isSearching else { return }
        await run(query: normalizedQuery, pageToken: token)
    }

    /// Waits for the in-flight debounce/search (tests).
    func waitForPendingSearch() async {
        await pending?.value
    }

    private func scheduleSearch() {
        pending?.cancel()
        let query = normalizedQuery
        guard !query.isEmpty else {
            hits = []
            hasResults = false
            nextPageToken = nil
            isSearching = false
            return
        }
        let clock = self.clock
        pending = Task { [weak self] in
            do {
                try await clock.sleep(for: Self.debounce)
            } catch {
                return // cancelled by a newer keystroke
            }
            guard !Task.isCancelled else { return }
            await self?.run(query: query, pageToken: nil)
        }
    }

    private func run(query: String, pageToken: String?) async {
        isSearching = true
        let result = await repository.search(query: query, pageToken: pageToken)
        // A newer query superseded this one while it was in flight.
        guard !Task.isCancelled, query == normalizedQuery else { return }
        isSearching = false
        switch result {
        case .success(let page):
            hits = pageToken == nil ? page.items : hits + page.items
            nextPageToken = page.nextPageToken
            hasResults = true
            if pageToken == nil {
                analytics.track(AnalyticsEvent(name: "search_performed", parameters: ["results": String(page.items.count)]))
            }
        case .failure(let failure):
            error = failure
        }
    }
}
