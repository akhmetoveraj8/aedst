import AedstCore
import Foundation
@testable import Auth

/// Scripted `OIDCTransport`: records every request and answers through `handler`.
final class StubTransport: @unchecked Sendable {
    struct Reply: Sendable {
        var status: Int
        var body: String
        var headers: [String: String] = [:]
    }

    private let lock = NSLock()
    private var recorded: [URLRequest] = []
    private let handler: @Sendable (URLRequest) throws -> Reply

    init(handler: @escaping @Sendable (URLRequest) throws -> Reply) {
        self.handler = handler
    }

    var requests: [URLRequest] { lock.withLock { recorded } }

    func requests(toPath path: String) -> [URLRequest] {
        requests.filter { $0.url?.path == path }
    }

    var transport: OIDCTransport {
        { [self] request in
            lock.withLock { recorded.append(request) }
            let reply = try handler(request)
            let response = HTTPURLResponse(
                url: request.url!,
                statusCode: reply.status,
                httpVersion: "HTTP/1.1",
                headerFields: reply.headers
            )!
            return (Data(reply.body.utf8), response)
        }
    }
}

enum OIDCFixtures {
    static let issuer = "https://idp.example.com"
    static let clientID = "client-1"
    static let now = Date(timeIntervalSince1970: 2_000_000)

    static let configuration = OIDCConfiguration(issuer: issuer, clientID: clientID)!

    static func discoveryJSON(
        issuer: String = OIDCFixtures.issuer,
        tokenEndpoint: String = "https://idp.example.com/oauth/v2/token",
        revocation: Bool = true,
        jwks: Bool = true
    ) -> String {
        var fields = [
            #""issuer":"\#(issuer)""#,
            #""authorization_endpoint":"https://idp.example.com/oauth/v2/authorize""#,
            #""token_endpoint":"\#(tokenEndpoint)""#,
        ]
        if jwks {
            fields.append(#""jwks_uri":"https://idp.example.com/oauth/v2/keys""#)
        }
        if revocation {
            fields.append(#""revocation_endpoint":"https://idp.example.com/oauth/v2/revoke""#)
        }
        return "{" + fields.joined(separator: ",") + "}"
    }

    /// The provider key that `transport(...)` publishes at the JWKS endpoint by default.
    static let signingKey = TestSigningKey.p256(keyID: "key-1")

    /// ID token claims (iss/aud/exp/sub are valid by default; each can be broken per test).
    static func idTokenClaims(
        nonce: String?,
        issuer: String = OIDCFixtures.issuer,
        audience: Any = OIDCFixtures.clientID,
        expiresAt: Date = OIDCFixtures.now.addingTimeInterval(3_600),
        subject: String = "user-1",
        extra: [String: Any] = [:]
    ) -> [String: Any] {
        var claims: [String: Any] = [
            "iss": issuer,
            "aud": audience,
            "exp": expiresAt.timeIntervalSince1970,
            "sub": subject,
        ]
        if let nonce { claims["nonce"] = nonce }
        return claims.merging(extra) { _, new in new }
    }

    /// ID token signed by `signingKey` (or `key`), with a valid signature.
    static func idToken(
        nonce: String?,
        issuer: String = OIDCFixtures.issuer,
        audience: Any = OIDCFixtures.clientID,
        expiresAt: Date = OIDCFixtures.now.addingTimeInterval(3_600),
        subject: String = "user-1",
        extra: [String: Any] = [:],
        key: TestSigningKey = OIDCFixtures.signingKey
    ) -> String {
        key.jwt(
            claims: idTokenClaims(
                nonce: nonce,
                issuer: issuer,
                audience: audience,
                expiresAt: expiresAt,
                subject: subject,
                extra: extra
            )
        )
    }

    static func jwksJSON(_ keys: [TestSigningKey] = [OIDCFixtures.signingKey]) -> String {
        TestSigningKey.jwksJSON(keys)
    }

    static func tokenJSON(
        accessToken: String = "access-1",
        refreshToken: String? = "refresh-1",
        idToken: String? = nil,
        expiresIn: Int? = 900
    ) -> String {
        var fields = [#""access_token":"\#(accessToken)""#, #""token_type":"Bearer""#]
        if let refreshToken { fields.append(#""refresh_token":"\#(refreshToken)""#) }
        if let idToken { fields.append(#""id_token":"\#(idToken)""#) }
        if let expiresIn { fields.append(#""expires_in":\#(expiresIn)"#) }
        return "{" + fields.joined(separator: ",") + "}"
    }

    /// Serves discovery, and answers token/revoke POSTs with the given replies.
    static func transport(
        token: @escaping @Sendable (URLRequest) -> StubTransport.Reply = { _ in .init(status: 200, body: OIDCFixtures.tokenJSON()) },
        revoke: StubTransport.Reply = .init(status: 200, body: ""),
        discovery: StubTransport.Reply = .init(status: 200, body: OIDCFixtures.discoveryJSON()),
        jwks: @escaping @Sendable () -> StubTransport.Reply = { .init(status: 200, body: OIDCFixtures.jwksJSON()) }
    ) -> StubTransport {
        StubTransport { request in
            switch request.url?.path {
            case "/.well-known/openid-configuration": discovery
            case "/oauth/v2/token": token(request)
            case "/oauth/v2/revoke": revoke
            case "/oauth/v2/keys": jwks()
            default: .init(status: 404, body: "")
            }
        }
    }

    static func formFields(of request: URLRequest) -> [String: String] {
        let body = request.httpBody.flatMap { String(data: $0, encoding: .utf8) } ?? ""
        var fields: [String: String] = [:]
        for pair in body.split(separator: "&") {
            let parts = pair.split(separator: "=", maxSplits: 1, omittingEmptySubsequences: false)
            guard parts.count == 2 else { continue }
            fields[String(parts[0]).removingPercentEncoding ?? ""] = String(parts[1]).removingPercentEncoding ?? ""
        }
        return fields
    }

    static func queryValue(_ name: String, in url: URL) -> String? {
        URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems?.first { $0.name == name }?.value
    }

    static func makeTokenClient(
        _ stub: StubTransport,
        configuration: OIDCConfiguration = OIDCFixtures.configuration
    ) -> (client: URLSessionOIDCTokenClient, discovery: OIDCDiscovery) {
        let discovery = OIDCDiscovery(configuration: configuration, transport: stub.transport)
        return (URLSessionOIDCTokenClient(configuration: configuration, discovery: discovery, transport: stub.transport), discovery)
    }
}

/// `WebAuthenticator` double. `onAuthenticate` builds the redirect from the authorization URL.
final class StubWebAuthenticator: WebAuthenticator, @unchecked Sendable {
    typealias Handler = @Sendable (URL) throws -> URL

    private let lock = NSLock()
    private var urls: [URL] = []
    private var schemes: [String] = []
    private let handler: Handler

    init(_ handler: @escaping Handler) {
        self.handler = handler
    }

    var receivedURLs: [URL] { lock.withLock { urls } }
    var receivedSchemes: [String] { lock.withLock { schemes } }

    /// Redirects back with `code` and the request's own `state` (or `state` override).
    static func approving(code: String = "auth-code", stateOverride: String? = nil) -> StubWebAuthenticator {
        StubWebAuthenticator { url in
            let state = stateOverride ?? OIDCFixtures.queryValue("state", in: url) ?? ""
            return URL(string: "\(OIDCFixtures.configuration.redirectURI)?code=\(code)&state=\(state)")!
        }
    }

    static func failing(_ error: WebAuthenticationError) -> StubWebAuthenticator {
        StubWebAuthenticator { _ in throw error }
    }

    @MainActor
    func authenticate(url: URL, callbackScheme: String) async throws -> URL {
        lock.withLock {
            urls.append(url)
            schemes.append(callbackScheme)
        }
        return try handler(url)
    }
}
