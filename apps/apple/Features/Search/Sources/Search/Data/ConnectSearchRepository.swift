import AedstCore
import AedstNetwork
import Foundation

/// `SearchRepository` over the generated `SearchService` client (the only file
/// naming `Aedst_Search_V1_*` types).
public struct ConnectSearchRepository: SearchRepository {
    private let client: Aedst_Search_V1_SearchServiceClient
    private let executor: AuthorizedRequestExecutor

    /// `client` must be the authenticated `ProtocolClient`.
    public init(client: ProtocolClient, executor: AuthorizedRequestExecutor) {
        self.client = Aedst_Search_V1_SearchServiceClient(client: client)
        self.executor = executor
    }

    public func search(query: String, pageToken: String?) async -> Outcome<Page<SearchHit>> {
        var request = Aedst_Search_V1_SearchRequest()
        request.query = query
        request.pageSize = 20
        request.pageToken = pageToken ?? ""
        let client = self.client
        let response = await executor.executeUnary { await client.search(request: request, headers: [:]) }
        return response.result
            .map { Page(items: $0.hits.map(SearchHit.init), nextPageToken: $0.nextPageToken) }
            .mapError { NetworkErrorMapping.map($0) }
    }
}

extension SearchHit {
    init(_ proto: Aedst_Search_V1_SearchHit) {
        let kind: Kind
        switch proto.kind {
        case .task: kind = .task
        case .media: kind = .media
        default: kind = .other
        }
        self.init(
            kind: kind,
            id: proto.id,
            title: proto.title,
            snippet: proto.snippet,
            link: proto.link,
            updatedAt: proto.hasUpdatedAt ? proto.updatedAt.date : nil
        )
    }
}
