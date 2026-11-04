import AedstCore
import Foundation

/// The single HTTP seam of the OIDC client: tests inject a closure, production
/// uses `OIDCTransports.default` (an ephemeral `URLSession`).
public typealias OIDCTransport = @Sendable (URLRequest) async throws -> (Data, URLResponse)

public enum OIDCTransports {
    /// Ephemeral session (no cookies, no disk cache): token and discovery traffic
    /// must not be cached or share state with the rest of the app.
    public static let `default`: OIDCTransport = OIDCTransports.urlSession(
        {
            let configuration = URLSessionConfiguration.ephemeral
            configuration.timeoutIntervalForRequest = 20
            configuration.timeoutIntervalForResource = 60
            configuration.waitsForConnectivity = false
            configuration.requestCachePolicy = .reloadIgnoringLocalCacheData
            configuration.urlCache = nil
            return URLSession(configuration: configuration)
        }()
    )

    public static func urlSession(_ session: URLSession) -> OIDCTransport {
        { request in try await session.data(for: request) }
    }
}

/// The subset of the provider document (OpenID Connect Discovery 1.0) this client uses.
public struct OIDCProviderMetadata: Sendable, Equatable {
    public let issuer: String
    public let authorizationEndpoint: URL
    public let tokenEndpoint: URL
    /// RFC 7009; `nil` when the provider does not advertise it.
    public let revocationEndpoint: URL?
    /// RP-initiated logout; advertised for a follow-up, not used yet.
    public let endSessionEndpoint: URL?
    /// JSON Web Key Set holding the keys that sign ID tokens. `nil` when the provider
    /// advertises none, in which case ID tokens cannot be verified and sign-in fails closed.
    public let jwksURI: URL?

    public init(
        issuer: String,
        authorizationEndpoint: URL,
        tokenEndpoint: URL,
        revocationEndpoint: URL? = nil,
        endSessionEndpoint: URL? = nil,
        jwksURI: URL? = nil
    ) {
        self.issuer = issuer
        self.authorizationEndpoint = authorizationEndpoint
        self.tokenEndpoint = tokenEndpoint
        self.revocationEndpoint = revocationEndpoint
        self.endSessionEndpoint = endSessionEndpoint
        self.jwksURI = jwksURI
    }
}

/// Fetches `<issuer>/.well-known/openid-configuration` and refuses anything that
/// does not belong to the configured issuer. Successful results are cached for the
/// process lifetime (endpoints are stable; a relaunch picks up changes).
public actor OIDCDiscovery {
    private struct Document: Decodable {
        let issuer: String
        let authorizationEndpoint: String
        let tokenEndpoint: String
        let revocationEndpoint: String?
        let endSessionEndpoint: String?
        let jwksURI: String?

        enum CodingKeys: String, CodingKey {
            case issuer
            case authorizationEndpoint = "authorization_endpoint"
            case tokenEndpoint = "token_endpoint"
            case revocationEndpoint = "revocation_endpoint"
            case endSessionEndpoint = "end_session_endpoint"
            case jwksURI = "jwks_uri"
        }
    }

    private let configuration: OIDCConfiguration
    private let transport: OIDCTransport
    private let logger = AedstLogger(category: "oidc")
    private var cached: OIDCProviderMetadata?

    public init(configuration: OIDCConfiguration, transport: @escaping OIDCTransport = OIDCTransports.default) {
        self.configuration = configuration
        self.transport = transport
    }

    public func metadata() async -> Outcome<OIDCProviderMetadata> {
        if let cached { return .success(cached) }

        var path = configuration.issuer
        while path.hasSuffix("/") { path.removeLast() }
        guard let url = URL(string: path + "/.well-known/openid-configuration") else {
            return .failure(.invalidInput(fields: ["AEDST_OIDC_ISSUER"]))
        }
        var request = URLRequest(url: url)
        request.httpMethod = "GET"
        request.setValue("application/json", forHTTPHeaderField: "Accept")

        let response: (Data, HTTPURLResponse)
        switch await OIDCHTTP.perform(request, using: transport) {
        case .success(let value): response = value
        case .failure(let error): return .failure(error)
        }
        guard (200..<300).contains(response.1.statusCode) else {
            return .failure(OIDCHTTP.error(for: response.1, body: response.0))
        }

        let document: Document
        do {
            document = try JSONDecoder().decode(Document.self, from: response.0)
        } catch {
            return .failure(.decoding(reason: "OIDC discovery document is not valid JSON"))
        }

        // Issuer mix-up defence (OIDC Discovery section 4.3): the document must name
        // the issuer it was fetched for, byte for byte.
        // These are `.decoding`, never `.unauthenticated`: `.unauthenticated` is reserved for the
        // token endpoint's `invalid_grant`, the only answer that may end a session.
        guard document.issuer == configuration.issuer else {
            logger.error("Discovery issuer mismatch")
            return .failure(.decoding(reason: "discovery issuer does not match the configured issuer"))
        }
        guard let authorization = validEndpoint(document.authorizationEndpoint),
              let token = validEndpoint(document.tokenEndpoint)
        else {
            logger.error("Discovery endpoints are missing or not https")
            return .failure(.decoding(reason: "discovery endpoints are missing or not https"))
        }

        let metadata = OIDCProviderMetadata(
            issuer: document.issuer,
            authorizationEndpoint: authorization,
            tokenEndpoint: token,
            revocationEndpoint: document.revocationEndpoint.flatMap(validEndpoint),
            endSessionEndpoint: document.endSessionEndpoint.flatMap(validEndpoint),
            jwksURI: document.jwksURI.flatMap(validEndpoint)
        )
        cached = metadata
        return .success(metadata)
    }

    private func validEndpoint(_ string: String) -> URL? {
        guard let url = URL(string: string), configuration.isAcceptableEndpoint(url) else { return nil }
        return url
    }
}

/// Shared HTTP plumbing for discovery and the token client: transport errors and
/// non-2xx answers become `AedstError` once, here.
enum OIDCHTTP {
    static func perform(
        _ request: URLRequest,
        using transport: OIDCTransport
    ) async -> Outcome<(Data, HTTPURLResponse)> {
        do {
            let (data, response) = try await transport(request)
            guard let http = response as? HTTPURLResponse else {
                return .failure(.unavailable(reason: "non-HTTP response"))
            }
            return .success((data, http))
        } catch {
            return .failure(.unavailable(reason: String(describing: error)))
        }
    }

    /// 429 -> `.rateLimited`, 5xx -> `.unavailable` (both transient); other statuses are
    /// protocol errors the caller usually refines from the body.
    static func error(for response: HTTPURLResponse, body: Data) -> AedstError {
        switch response.statusCode {
        case 429:
            let retryAfter = response.value(forHTTPHeaderField: "Retry-After").flatMap { TimeInterval($0) }
            return .rateLimited(retryAfter: retryAfter)
        case 500...599:
            return .unavailable(reason: "http \(response.statusCode)")
        default:
            return .unknown(reason: "http \(response.statusCode)")
        }
    }
}
