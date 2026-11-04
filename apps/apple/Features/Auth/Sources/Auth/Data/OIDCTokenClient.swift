import AedstCore
import Foundation

/// What the token endpoint returned (RFC 6749 section 5.1), reduced to what the app uses.
public struct OIDCTokenResponse: Sendable, Equatable {
    /// Lifetime assumed when the provider omits `expires_in` (RFC 6749 makes it RECOMMENDED only).
    public static let defaultAccessTokenLifetime: TimeInterval = 300

    public let accessToken: String
    /// `nil` when the provider did not rotate it (refresh) or `offline_access` was not granted.
    public let refreshToken: String?
    public let idToken: String?
    public let expiresIn: TimeInterval?

    public init(accessToken: String, refreshToken: String?, idToken: String?, expiresIn: TimeInterval?) {
        self.accessToken = accessToken
        self.refreshToken = refreshToken
        self.idToken = idToken
        self.expiresIn = expiresIn
    }

    /// Absolute-expiry pair for the session store. A refresh response that omits
    /// `refresh_token` keeps the previous one (RFC 6749 section 6). Returns `nil` when
    /// there is no refresh token at all. Absolute refresh expiry is an estimate, see
    /// `OIDCConfiguration.refreshTokenFallbackTTL`.
    func tokenPair(issuedAt now: Date, previousRefreshToken: String?, refreshTTL: TimeInterval) -> TokenPair? {
        guard let refreshToken = refreshToken ?? previousRefreshToken, !refreshToken.isEmpty else { return nil }
        return TokenPair(
            accessToken: accessToken,
            refreshToken: refreshToken,
            accessTokenExpiresAt: now.addingTimeInterval(expiresIn ?? Self.defaultAccessTokenLifetime),
            refreshTokenExpiresAt: now.addingTimeInterval(refreshTTL)
        )
    }
}

/// Talks to the provider's token and revocation endpoints. Error contract (relied on by
/// `OIDCTokenRefresher`): `.unauthenticated` means the provider answered `invalid_grant`
/// (bad/expired/revoked/reused code or refresh token) and nothing else ever produces it;
/// 429 is `.rateLimited`; transport failures and 5xx are `.unavailable`.
public protocol OIDCTokenClient: Sendable {
    func exchangeCode(_ code: String, codeVerifier: String) async -> Outcome<OIDCTokenResponse>
    func refresh(refreshToken: String) async -> Outcome<OIDCTokenResponse>
    /// RFC 7009. `.failure(.unsupported)` when the provider advertises no revocation endpoint.
    func revoke(refreshToken: String) async -> Outcome<Void>
}

/// Public-client (no secret) implementation over an injectable transport.
public struct URLSessionOIDCTokenClient: OIDCTokenClient {
    private struct SuccessBody: Decodable {
        let accessToken: String?
        let tokenType: String?
        let expiresIn: Double?
        let refreshToken: String?
        let idToken: String?

        enum CodingKeys: String, CodingKey {
            case accessToken = "access_token"
            case tokenType = "token_type"
            case expiresIn = "expires_in"
            case refreshToken = "refresh_token"
            case idToken = "id_token"
        }
    }

    private struct ErrorBody: Decodable {
        let error: String?
    }

    private let configuration: OIDCConfiguration
    private let discovery: OIDCDiscovery
    private let transport: OIDCTransport

    public init(
        configuration: OIDCConfiguration,
        discovery: OIDCDiscovery,
        transport: @escaping OIDCTransport = OIDCTransports.default
    ) {
        self.configuration = configuration
        self.discovery = discovery
        self.transport = transport
    }

    public func exchangeCode(_ code: String, codeVerifier: String) async -> Outcome<OIDCTokenResponse> {
        await requestTokens([
            ("grant_type", "authorization_code"),
            ("code", code),
            ("redirect_uri", configuration.redirectURI),
            ("client_id", configuration.clientID),
            ("code_verifier", codeVerifier),
        ])
    }

    /// Exactly one request, never retried: refresh tokens rotate, so replaying a request
    /// whose response was lost would present an already-rotated token and trip the
    /// provider's reuse detection (see `OIDCTokenRefresher`).
    public func refresh(refreshToken: String) async -> Outcome<OIDCTokenResponse> {
        await requestTokens([
            ("grant_type", "refresh_token"),
            ("refresh_token", refreshToken),
            ("client_id", configuration.clientID),
        ])
    }

    public func revoke(refreshToken: String) async -> Outcome<Void> {
        let metadata: OIDCProviderMetadata
        switch await discovery.metadata() {
        case .success(let value): metadata = value
        case .failure(let error): return .failure(error)
        }
        guard let endpoint = metadata.revocationEndpoint else { return .failure(.unsupported) }

        switch await post(
            to: endpoint,
            fields: [
                ("token", refreshToken),
                ("token_type_hint", "refresh_token"),
                ("client_id", configuration.clientID),
            ]
        ) {
        case .failure(let error):
            return .failure(error)
        case .success(let (data, response)):
            // RFC 7009 section 2.2: 200 even for unknown tokens.
            return (200..<300).contains(response.statusCode) ? .success(()) : .failure(Self.error(response, data))
        }
    }

    private func requestTokens(_ fields: [(String, String)]) async -> Outcome<OIDCTokenResponse> {
        let metadata: OIDCProviderMetadata
        switch await discovery.metadata() {
        case .success(let value): metadata = value
        case .failure(let error): return .failure(error)
        }

        switch await post(to: metadata.tokenEndpoint, fields: fields) {
        case .success(let (data, response)): return Self.parseTokens(data, response)
        case .failure(let error): return .failure(error)
        }
    }

    private static func parseTokens(_ data: Data, _ response: HTTPURLResponse) -> Outcome<OIDCTokenResponse> {
        guard (200..<300).contains(response.statusCode) else { return .failure(error(response, data)) }

        guard let body = try? JSONDecoder().decode(SuccessBody.self, from: data),
              let accessToken = body.accessToken, !accessToken.isEmpty
        else {
            return .failure(.decoding(reason: "token response carried no access_token"))
        }
        if let type = body.tokenType, type.caseInsensitiveCompare("Bearer") != .orderedSame {
            return .failure(.decoding(reason: "unsupported token_type"))
        }
        return .success(
            OIDCTokenResponse(
                accessToken: accessToken,
                refreshToken: body.refreshToken,
                idToken: body.idToken,
                expiresIn: body.expiresIn
            )
        )
    }

    private func post(to url: URL, fields: [(String, String)]) async -> Outcome<(Data, HTTPURLResponse)> {
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/x-www-form-urlencoded", forHTTPHeaderField: "Content-Type")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.httpBody = FormEncoding.body(fields)
        return await OIDCHTTP.perform(request, using: transport)
    }

    /// `invalid_grant` (HTTP 400/401, RFC 6749 section 5.2) is the only protocol answer
    /// that means "this grant is dead"; every other status maps to a transient or an
    /// unknown error so that a misconfiguration can never sign everyone out.
    private static func error(_ response: HTTPURLResponse, _ data: Data) -> AedstError {
        if response.statusCode == 400 || response.statusCode == 401,
           let body = try? JSONDecoder().decode(ErrorBody.self, from: data) {
            if body.error == "invalid_grant" { return .unauthenticated }
            return .unknown(reason: "oauth error \(body.error ?? "none") http \(response.statusCode)")
        }
        return OIDCHTTP.error(for: response, body: data)
    }
}

/// `application/x-www-form-urlencoded` (WHATWG URL standard) with RFC 3986 unreserved
/// characters left as is. Foundation has no form encoder; `URLComponents` would leave
/// `+` and `&` inside values unescaped.
enum FormEncoding {
    private static let unreserved = CharacterSet(
        charactersIn: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~"
    )

    static func encode(_ value: String) -> String {
        value.addingPercentEncoding(withAllowedCharacters: unreserved) ?? ""
    }

    static func body(_ fields: [(String, String)]) -> Data {
        Data(fields.map { "\(encode($0.0))=\(encode($0.1))" }.joined(separator: "&").utf8)
    }
}
