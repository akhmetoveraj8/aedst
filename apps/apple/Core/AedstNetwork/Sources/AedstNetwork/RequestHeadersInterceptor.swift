import Connect
import Foundation

/// Stamps the headers every first-party unary call carries, authenticated or not (registered on both clients in
/// `ConnectClientFactory`): `X-Aedst-Client: apple/<semver>` (`ClientIdentity`, ADR-0009; metrics and the version
/// gate, not authN). A missing or unusable version sends no header (see `ClientIdentity.applying(to:)`).
///
/// Swift analogue of `RequestHeadersInterceptor` in `apps/android/core/network`. The response side of ADR-0009 is
/// `ClientUpgradeInterceptor`. Written against connect-swift 1.2.3's `UnaryInterceptor` (same shape as
/// `AuthInterceptor`); UNVERIFIED until the first Xcode build.
public final class RequestHeadersInterceptor: UnaryInterceptor, Sendable {
    private let identity: ClientIdentity

    public init(identity: ClientIdentity) {
        self.identity = identity
    }

    @Sendable
    public func handleUnaryRequest<Message: ProtobufMessage>(
        _ request: HTTPRequest<Message>,
        proceed: @escaping @Sendable (Result<HTTPRequest<Message>, ConnectError>) -> Void
    ) {
        proceed(
            .success(
                HTTPRequest(
                    url: request.url,
                    headers: identity.applying(to: request.headers),
                    message: request.message,
                    method: request.method,
                    trailers: request.trailers,
                    idempotencyLevel: request.idempotencyLevel
                )
            )
        )
    }

    @Sendable
    public func handleUnaryResponse<Message: ProtobufMessage>(
        _ response: ResponseMessage<Message>,
        proceed: @escaping @Sendable (ResponseMessage<Message>) -> Void
    ) {
        proceed(response)
    }
}
