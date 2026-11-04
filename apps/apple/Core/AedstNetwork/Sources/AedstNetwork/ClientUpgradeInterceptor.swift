import Connect
import Foundation

/// Response side of ADR-0009 for every unary call, authenticated or not (registered on both clients in
/// `ConnectClientFactory`): when the server answers `failed_precondition` + `CLIENT_UPGRADE_REQUIRED`, it reports
/// it to the `ClientUpgradeMonitor` so the app can show the blocking upgrade screen. The response itself is passed
/// on unchanged; `NetworkErrorMapping` turns it into `AedstError.upgradeRequired` for the calling feature. The
/// request is passed on untouched: `X-Aedst-Client` is stamped by `RequestHeadersInterceptor`.
///
/// Swift analogue of `ClientUpgrade.kt` in `apps/android/core/network` and of the server's
/// `ClientVersionInterceptor` (Go). Written against connect-swift 1.2.3's `UnaryInterceptor` (same shape as
/// `AuthInterceptor`); UNVERIFIED until the first Xcode build.
public final class ClientUpgradeInterceptor: UnaryInterceptor, Sendable {
    private let monitor: ClientUpgradeMonitor?

    public init(monitor: ClientUpgradeMonitor? = nil) {
        self.monitor = monitor
    }

    @Sendable
    public func handleUnaryRequest<Message: ProtobufMessage>(
        _ request: HTTPRequest<Message>,
        proceed: @escaping @Sendable (Result<HTTPRequest<Message>, ConnectError>) -> Void
    ) {
        proceed(.success(request))
    }

    @Sendable
    public func handleUnaryResponse<Message: ProtobufMessage>(
        _ response: ResponseMessage<Message>,
        proceed: @escaping @Sendable (ResponseMessage<Message>) -> Void
    ) {
        if case .failure(let error) = response.result, UpgradeRequiredDetection.isUpgradeRequired(error) {
            monitor?.report()
        }
        proceed(response)
    }
}
