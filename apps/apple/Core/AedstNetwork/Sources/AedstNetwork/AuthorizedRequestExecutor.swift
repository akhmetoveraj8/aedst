import AedstCore
import Connect

/// Runs an authenticated call and, if the server answers "unauthenticated",
/// refreshes the token pair once and **re-issues the original call** — so a
/// merely-expired access token is invisible to the user.
///
/// Rules:
/// - Exactly one retry per call (no loops on a permanently-401 endpoint).
/// - Only `RefreshResult.refreshed` triggers the retry. `.rejected` means the
///   refresh token is dead (the `SessionStore` has already ended the session
///   and emitted `SessionEvent.expired`): the *original* unauthenticated failure
///   goes back to the caller. `.unavailable` means offline/5xx: the session is
///   kept and the call fails as a *retryable* `unavailable` error instead (behaviour
///   `session-refresh`, "a transient refresh failure ... fails as a retryable error"),
///   so the outbox retries it and the UI shows a network toast, not "sign in again".
/// - Concurrent 401s share one refresh (`SessionStore` de-duplicates).
///
/// Every feature's remote data source that uses the *authenticated* client
/// routes its unary calls through `executeUnary`.
public struct AuthorizedRequestExecutor: Sendable {
    private let tokenProvider: any TokenProvider

    public init(tokenProvider: any TokenProvider) {
        self.tokenProvider = tokenProvider
    }

    /// Transport-agnostic core (unit-tested with plain values).
    public func execute<Response>(
        _ call: () async -> Response,
        isUnauthenticated: (Response) -> Bool,
        whenRefreshUnavailable: (Response) -> Response = { $0 }
    ) async -> Response {
        let first = await call()
        guard isUnauthenticated(first) else { return first }

        switch await tokenProvider.refreshAccessToken() {
        case .refreshed:
            return await call()
        case .rejected:
            return first
        case .unavailable:
            return whenRefreshUnavailable(first)
        }
    }

    /// Convenience for generated Connect unary calls.
    public func executeUnary<Output: ProtobufMessage>(
        _ call: () async -> ResponseMessage<Output>
    ) async -> ResponseMessage<Output> {
        await execute(
            call,
            isUnauthenticated: { $0.code == .unauthenticated },
            whenRefreshUnavailable: Self.refreshUnavailable
        )
    }

    /// The 401 the call got, re-labelled as a transient failure (NOTE: `ResponseMessage.init(code:headers:result:trailers:)`
    /// per connect-swift 1.2.3; UNVERIFIED until the first build).
    private static func refreshUnavailable<Output: ProtobufMessage>(
        _ first: ResponseMessage<Output>
    ) -> ResponseMessage<Output> {
        ResponseMessage(
            code: .unavailable,
            headers: first.headers,
            result: .failure(
                ConnectError(
                    code: .unavailable,
                    message: "token refresh unavailable",
                    exception: nil,
                    details: [],
                    metadata: [:]
                )
            ),
            trailers: first.trailers
        )
    }
}
