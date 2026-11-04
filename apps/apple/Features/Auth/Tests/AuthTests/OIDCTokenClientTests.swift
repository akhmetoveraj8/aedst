import AedstCore
import AedstTesting
import Foundation
import Testing
@testable import Auth

@Suite("URLSessionOIDCTokenClient")
struct OIDCTokenClientTests {
    @Test("code exchange posts a public-client form with the PKCE verifier and parses the tokens")
    func exchangeCode() async throws {
        let stub = OIDCFixtures.transport(token: { _ in
            .init(status: 200, body: OIDCFixtures.tokenJSON(idToken: "id.token.sig"))
        })
        let (client, _) = OIDCFixtures.makeTokenClient(stub)

        let result = await client.exchangeCode("code-1", codeVerifier: "verifier-1")

        #expect(result.value == OIDCTokenResponse(
            accessToken: "access-1", refreshToken: "refresh-1", idToken: "id.token.sig", expiresIn: 900
        ))
        let request = try #require(stub.requests(toPath: "/oauth/v2/token").first)
        #expect(request.httpMethod == "POST")
        #expect(request.value(forHTTPHeaderField: "Content-Type") == "application/x-www-form-urlencoded")
        let form = OIDCFixtures.formFields(of: request)
        #expect(form["grant_type"] == "authorization_code")
        #expect(form["code"] == "code-1")
        #expect(form["code_verifier"] == "verifier-1")
        #expect(form["client_id"] == "client-1")
        #expect(form["redirect_uri"] == "com.aedst.apple:/oauth2redirect")
        #expect(form["client_secret"] == nil, "public client: no secret")
    }

    @Test("form values are percent-encoded, including + and &")
    func formEncoding() {
        let body = String(decoding: FormEncoding.body([("a", "x+y&z=1 2"), ("b~", "é")]), as: UTF8.self)
        #expect(body == "a=x%2By%26z%3D1%202&b~=%C3%A9")
    }

    @Test("refresh sends grant_type=refresh_token exactly once")
    func refreshRequest() async throws {
        let stub = OIDCFixtures.transport()
        let (client, _) = OIDCFixtures.makeTokenClient(stub)

        _ = await client.refresh(refreshToken: "r-1")

        let form = OIDCFixtures.formFields(of: try #require(stub.requests(toPath: "/oauth/v2/token").first))
        #expect(form["grant_type"] == "refresh_token")
        #expect(form["refresh_token"] == "r-1")
        #expect(stub.requests(toPath: "/oauth/v2/token").count == 1)
    }

    @Test("invalid_grant is .unauthenticated; it is the only answer that is")
    func invalidGrant() async {
        let stub = OIDCFixtures.transport(token: { _ in
            .init(status: 400, body: #"{"error":"invalid_grant","error_description":"expired"}"#)
        })
        let (client, _) = OIDCFixtures.makeTokenClient(stub)
        #expect(await client.refresh(refreshToken: "r").error == .unauthenticated)

        let misconfigured = OIDCFixtures.transport(token: { _ in
            .init(status: 401, body: #"{"error":"invalid_client"}"#)
        })
        let (other, _) = OIDCFixtures.makeTokenClient(misconfigured)
        #expect(await other.refresh(refreshToken: "r").error != .unauthenticated)
    }

    @Test("5xx is .unavailable, 429 is .rateLimited with Retry-After")
    func transientStatuses() async {
        let server = OIDCFixtures.transport(token: { _ in .init(status: 502, body: "<html>bad gateway</html>") })
        #expect(await OIDCFixtures.makeTokenClient(server).client.refresh(refreshToken: "r").error == .unavailable(reason: "http 502"))

        let throttled = OIDCFixtures.transport(token: { _ in
            .init(status: 429, body: "", headers: ["Retry-After": "7"])
        })
        #expect(await OIDCFixtures.makeTokenClient(throttled).client.refresh(refreshToken: "r").error == .rateLimited(retryAfter: 7))
    }

    @Test("a 200 without an access token is a decoding error")
    func emptyBody() async {
        let stub = OIDCFixtures.transport(token: { _ in .init(status: 200, body: "{}") })
        let result = await OIDCFixtures.makeTokenClient(stub).client.refresh(refreshToken: "r")
        guard case .failure(.decoding) = result else {
            Issue.record("expected .decoding, got \(result)")
            return
        }
    }

    @Test("revocation posts the refresh token with a type hint; without an endpoint it is unsupported")
    func revocation() async throws {
        let stub = OIDCFixtures.transport()
        let (client, _) = OIDCFixtures.makeTokenClient(stub)
        #expect(await client.revoke(refreshToken: "r-1").error == nil)
        let form = OIDCFixtures.formFields(of: try #require(stub.requests(toPath: "/oauth/v2/revoke").first))
        #expect(form["token"] == "r-1")
        #expect(form["token_type_hint"] == "refresh_token")
        #expect(form["client_id"] == "client-1")

        let noEndpoint = OIDCFixtures.transport(discovery: .init(status: 200, body: OIDCFixtures.discoveryJSON(revocation: false)))
        #expect(await OIDCFixtures.makeTokenClient(noEndpoint).client.revoke(refreshToken: "r").error == .unsupported)
    }
}

@Suite("OIDCTokenRefresher")
struct OIDCTokenRefresherTests {
    private func refresher(_ stub: StubTransport) -> OIDCTokenRefresher {
        OIDCTokenRefresher(
            tokenClient: OIDCFixtures.makeTokenClient(stub).client,
            configuration: OIDCFixtures.configuration,
            clock: ManualClock(now: OIDCFixtures.now)
        )
    }

    @Test("success becomes .refreshed with absolute expiries and the rotated refresh token")
    func success() async {
        let stub = OIDCFixtures.transport(token: { _ in
            .init(status: 200, body: OIDCFixtures.tokenJSON(accessToken: "a-2", refreshToken: "r-2", expiresIn: 600))
        })

        let result = await refresher(stub).refresh(refreshToken: "r-1")

        #expect(result == .refreshed(TokenPair(
            accessToken: "a-2",
            refreshToken: "r-2",
            accessTokenExpiresAt: OIDCFixtures.now.addingTimeInterval(600),
            refreshTokenExpiresAt: OIDCFixtures.now.addingTimeInterval(30 * 86_400)
        )))
    }

    @Test("a response without refresh_token keeps the previous one (RFC 6749 section 6)")
    func keepsPreviousRefreshToken() async {
        let stub = OIDCFixtures.transport(token: { _ in
            .init(status: 200, body: OIDCFixtures.tokenJSON(refreshToken: nil))
        })

        guard case .refreshed(let pair) = await refresher(stub).refresh(refreshToken: "r-1") else {
            Issue.record("expected .refreshed")
            return
        }
        #expect(pair.refreshToken == "r-1")
    }

    @Test("invalid_grant ends the session (.rejected)")
    func invalidGrantIsRejected() async {
        let stub = OIDCFixtures.transport(token: { _ in .init(status: 400, body: #"{"error":"invalid_grant"}"#) })
        #expect(await refresher(stub).refresh(refreshToken: "r") == .rejected)
    }

    @Test("5xx, throttling, offline, bad config and discovery trouble keep the session (.unavailable)")
    func transientIsUnavailable() async {
        let replies: [StubTransport.Reply] = [
            .init(status: 500, body: ""),
            .init(status: 429, body: ""),
            .init(status: 401, body: #"{"error":"invalid_client"}"#),
            .init(status: 400, body: #"{"error":"invalid_request"}"#),
            .init(status: 200, body: "not json"),
        ]
        for reply in replies {
            #expect(await refresher(OIDCFixtures.transport(token: { _ in reply })).refresh(refreshToken: "r") == .unavailable)
        }
        let offline = StubTransport { _ in throw URLError(.notConnectedToInternet) }
        #expect(await refresher(offline).refresh(refreshToken: "r") == .unavailable)

        let wrongIssuer = OIDCFixtures.transport(discovery: .init(status: 200, body: OIDCFixtures.discoveryJSON(issuer: "https://evil.example.com")))
        #expect(await refresher(wrongIssuer).refresh(refreshToken: "r") == .unavailable)
    }

    @Test("a refresh is attempted exactly once (tokens rotate; never blind-retry)")
    func noBlindRetry() async {
        let stub = OIDCFixtures.transport(token: { _ in .init(status: 503, body: "") })

        _ = await refresher(stub).refresh(refreshToken: "r")

        #expect(stub.requests(toPath: "/oauth/v2/token").count == 1)
    }
}
