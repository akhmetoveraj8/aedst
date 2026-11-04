import AedstCore
import Connect
import Foundation

/// One `ProtocolClient` per app process, shared by every feature module's
/// generated Connect service client (see `Generated/README.md`). Analogous
/// to the single Retrofit instance built in `apps/android/core/network`.
///
/// Targets connect-swift 1.2.3 (`ProtocolClientConfig`'s `interceptors:` takes
/// `InterceptorFactory` values; `codec:` takes a `Codec` instance such as
/// `ProtoCodec()` — there is no `.proto` shorthand).
public enum ConnectClientFactory {
    /// Ephemeral session: no on-disk URL cache or cookie jar, so bearer-token
    /// responses are never written to the app container. Bounded timeouts so
    /// a dead network fails fast instead of hanging a spinner.
    static func makeSessionConfiguration() -> URLSessionConfiguration {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.timeoutIntervalForRequest = 30
        configuration.timeoutIntervalForResource = 60
        configuration.waitsForConnectivity = false
        configuration.httpCookieStorage = nil
        configuration.httpShouldSetCookies = false
        configuration.urlCache = nil
        configuration.requestCachePolicy = .reloadIgnoringLocalCacheData
        return configuration
    }

    /// Every authenticated call goes through this
    /// client: it attaches the bearer token and identifies the app (`X-Aedst-Client`, via `RequestHeadersInterceptor`). Pair it with
    /// `AuthorizedRequestExecutor` at the call site for refresh-and-retry.
    public static func makeClient(
        environment: APIEnvironment,
        tokenProvider: any TokenProvider,
        identity: ClientIdentity = .fromBundle(),
        upgradeMonitor: ClientUpgradeMonitor? = nil
    ) -> ProtocolClient {
        ProtocolClient(
            httpClient: URLSessionHTTPClient(configuration: makeSessionConfiguration()),
            config: ProtocolClientConfig(
                host: environment.baseURL.absoluteString,
                networkProtocol: .connect,
                codec: ProtoCodec(),
                interceptors: [
                    InterceptorFactory { _ in RequestHeadersInterceptor(identity: identity) },
                    InterceptorFactory { _ in ClientUpgradeInterceptor(monitor: upgradeMonitor) },
                    InterceptorFactory { _ in AuthInterceptor(tokenProvider: tokenProvider) },
                ]
            )
        )
    }

    /// No `AuthInterceptor` (only `RequestHeadersInterceptor` and `ClientUpgradeInterceptor`) — used only for the calls that can't have
    /// a bearer token (e.g. capabilities, read before sign-in).
    /// Breaks what would otherwise be a circular dependency (the authenticated
    /// client needs a `TokenProvider`, whose refresh handler needs a client).
    public static func makePlainClient(
        environment: APIEnvironment,
        identity: ClientIdentity = .fromBundle(),
        upgradeMonitor: ClientUpgradeMonitor? = nil
    ) -> ProtocolClient {
        ProtocolClient(
            httpClient: URLSessionHTTPClient(configuration: makeSessionConfiguration()),
            config: ProtocolClientConfig(
                host: environment.baseURL.absoluteString,
                networkProtocol: .connect,
                codec: ProtoCodec(),
                interceptors: [
                    InterceptorFactory { _ in RequestHeadersInterceptor(identity: identity) },
                    InterceptorFactory { _ in ClientUpgradeInterceptor(monitor: upgradeMonitor) },
                ]
            )
        )
    }
}
