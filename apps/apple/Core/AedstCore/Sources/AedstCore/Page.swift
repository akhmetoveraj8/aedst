/// One page of a keyset-paginated server list (`page_token` / `next_page_token`
/// in every `List*` RPC). `nextPageToken == nil` means there is no next page.
/// Tokens are opaque: echo them back verbatim, never parse or build one.
public struct Page<Item: Sendable>: Sendable {
    /// Items of this page, in server order.
    public let items: [Item]
    /// Token for the next page, or `nil` when this is the last page.
    public let nextPageToken: String?

    /// Creates a page; an empty `nextPageToken` is normalised to `nil`.
    public init(items: [Item], nextPageToken: String?) {
        self.items = items
        self.nextPageToken = (nextPageToken?.isEmpty ?? true) ? nil : nextPageToken
    }
}

extension Page: Equatable where Item: Equatable {}
