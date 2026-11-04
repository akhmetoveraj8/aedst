import AedstCore
import Connect
import Foundation

/// Attaches the current bearer token to every outgoing unary call — nothing
/// else. Refresh-and-retry on a 401 is deliberately *not* done here: an
/// interceptor cannot re-issue the original request, so `AuthorizedRequestExecutor`
/// wraps the call site and retries it once with the refreshed token (which
/// this interceptor then picks up, because it reads the token per request).
/// Registered in `ConnectClientFactory` — the Swift analogue of the OkHttp
/// `AuthInterceptor` in `apps/android/core/network`.
///
/// Written against connect-swift 1.2.3's `UnaryInterceptor` protocol
/// (callback-style hooks). Only unary calls are intercepted: this class
/// conforms to `UnaryInterceptor` but not `StreamInterceptor`, so
/// `InterceptorFactory` skips it for streams. Add a `StreamInterceptor`
/// conformance when the first streaming RPC needs auth.
public final class AuthInterceptor: UnaryInterceptor, Sendable {
    private let tokenProvider: any TokenProvider

    public init(tokenProvider: any TokenProvider) {
        self.tokenProvider = tokenProvider
    }

    @Sendable
    public func handleUnaryRequest<Message: ProtobufMessage>(
        _ request: HTTPRequest<Message>,
        proceed: @escaping @Sendable (Result<HTTPRequest<Message>, ConnectError>) -> Void
    ) {
        Task { [tokenProvider] in
            guard let token = await tokenProvider.currentAccessToken() else {
                proceed(.success(request))
                return
            }
            var headers = request.headers
            headers["Authorization"] = ["Bearer \(token)"]
            proceed(
                .success(
                    HTTPRequest(
                        url: request.url,
                        headers: headers,
                        message: request.message,
                        method: request.method,
                        trailers: request.trailers,
                        idempotencyLevel: request.idempotencyLevel
                    )
                )
            )
        }
    }

    @Sendable
    public func handleUnaryResponse<Message: ProtobufMessage>(
        _ response: ResponseMessage<Message>,
        proceed: @escaping @Sendable (ResponseMessage<Message>) -> Void
    ) {
        proceed(response)
    }
}
