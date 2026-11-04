import AedstCore
import Foundation
import Testing
@testable import Auth

@Suite("OIDCAuthorizationRequest")
struct OIDCAuthorizationRequestTests {
    private let configuration = OIDCFixtures.configuration
    private let metadata = OIDCProviderMetadata(
        issuer: OIDCFixtures.issuer,
        authorizationEndpoint: URL(string: "https://idp.example.com/oauth/v2/authorize")!,
        tokenEndpoint: URL(string: "https://idp.example.com/oauth/v2/token")!
    )
    private let verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"

    private func makeRequest() throws -> OIDCAuthorizationRequest {
        try #require(
            OIDCAuthorizationRequest(
                configuration: configuration,
                metadata: metadata,
                state: "state-1",
                nonce: "nonce-1",
                codeVerifier: verifier
            )
        )
    }

    @Test("the authorization URL carries every required parameter, S256 only")
    func authorizationURL() throws {
        let url = try makeRequest().url
        func value(_ name: String) -> String? { OIDCFixtures.queryValue(name, in: url) }

        #expect(url.absoluteString.hasPrefix("https://idp.example.com/oauth/v2/authorize?"))
        #expect(value("response_type") == "code")
        #expect(value("client_id") == "client-1")
        #expect(value("redirect_uri") == "com.aedst.apple:/oauth2redirect")
        #expect(value("scope") == "openid profile email offline_access")
        #expect(value("state") == "state-1")
        #expect(value("nonce") == "nonce-1")
        #expect(value("code_challenge") == "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM")
        #expect(value("code_challenge_method") == "S256")
        #expect(!url.absoluteString.contains(verifier), "the verifier must never be sent to the browser")
    }

    @Test("a redirect with the matching state yields the code")
    func codeAccepted() throws {
        let request = try makeRequest()
        let callback = URL(string: "com.aedst.apple:/oauth2redirect?code=abc&state=state-1")!

        #expect(request.authorizationCode(from: callback, configuration: configuration).value == "abc")
    }

    @Test("a state mismatch or missing state is rejected before the code is used")
    func stateMismatch() throws {
        let request = try makeRequest()

        for query in ["code=abc&state=other", "code=abc"] {
            let callback = URL(string: "com.aedst.apple:/oauth2redirect?\(query)")!
            #expect(request.authorizationCode(from: callback, configuration: configuration).error == .unauthenticated)
        }
    }

    @Test("a redirect to another scheme or path is rejected")
    func foreignRedirect() throws {
        let request = try makeRequest()

        for raw in ["other.app:/oauth2redirect?code=abc&state=state-1", "com.aedst.apple:/elsewhere?code=abc&state=state-1"] {
            #expect(request.authorizationCode(from: URL(string: raw)!, configuration: configuration).error == .unauthenticated)
        }
    }

    @Test("consent denied is a cancellation, other provider errors are failures")
    func providerErrors() throws {
        let request = try makeRequest()
        let denied = URL(string: "com.aedst.apple:/oauth2redirect?error=access_denied&state=state-1")!
        let broken = URL(string: "com.aedst.apple:/oauth2redirect?error=server_error&state=state-1")!

        #expect(request.authorizationCode(from: denied, configuration: configuration).error == .cancelled)
        #expect(request.authorizationCode(from: broken, configuration: configuration).error != .cancelled)
        #expect(request.authorizationCode(from: broken, configuration: configuration).error != nil)
    }

    @Test("generated requests use fresh random state, nonce and verifier")
    func generatedValuesDiffer() throws {
        let first = try OIDCAuthorizationRequest.make(configuration: configuration, metadata: metadata)
        let second = try OIDCAuthorizationRequest.make(configuration: configuration, metadata: metadata)

        #expect(first.state != second.state)
        #expect(first.nonce != second.nonce)
        #expect(first.codeVerifier != second.codeVerifier)
        #expect(OIDCFixtures.queryValue("code_challenge", in: first.url) == PKCE.challenge(for: first.codeVerifier))
    }
}

@Suite("IDTokenValidator")
struct IDTokenValidatorTests {
    private func subject(_ token: String, nonce: String = "n-1") -> Outcome<String> {
        IDTokenValidator.subject(
            ofIDToken: token,
            issuer: OIDCFixtures.issuer,
            clientID: OIDCFixtures.clientID,
            expectedNonce: nonce,
            now: OIDCFixtures.now
        )
    }

    @Test("a token with matching iss, aud, exp and nonce yields its subject")
    func valid() {
        #expect(subject(OIDCFixtures.idToken(nonce: "n-1")).value == "user-1")
    }

    @Test("aud may be an array containing the client id")
    func audienceArray() {
        let token = OIDCFixtures.idToken(nonce: "n-1", audience: ["project-9", OIDCFixtures.clientID])
        #expect(subject(token).value == "user-1")
    }

    @Test("wrong or missing nonce is rejected")
    func nonce() {
        #expect(subject(OIDCFixtures.idToken(nonce: "other")).error == .unauthenticated)
        #expect(subject(OIDCFixtures.idToken(nonce: nil)).error == .unauthenticated)
    }

    @Test("an audience without our client id is rejected")
    func audience() {
        #expect(subject(OIDCFixtures.idToken(nonce: "n-1", audience: "someone-else")).error == .unauthenticated)
        #expect(subject(OIDCFixtures.idToken(nonce: "n-1", audience: ["a", "b"])).error == .unauthenticated)
    }

    @Test("a different issuer is rejected")
    func issuer() {
        #expect(subject(OIDCFixtures.idToken(nonce: "n-1", issuer: "https://evil.example.com")).error == .unauthenticated)
    }

    @Test("an expired token is rejected, within 60 s of skew it is not")
    func expiry() {
        let expired = OIDCFixtures.idToken(nonce: "n-1", expiresAt: OIDCFixtures.now.addingTimeInterval(-120))
        let skewed = OIDCFixtures.idToken(nonce: "n-1", expiresAt: OIDCFixtures.now.addingTimeInterval(-30))
        #expect(subject(expired).error == .unauthenticated)
        #expect(subject(skewed).value == "user-1")
    }

    @Test("garbage is a decoding error, not a crash")
    func malformed() {
        #expect(subject("not-a-jwt").error != nil)
        #expect(subject("a.b.c").error != nil)
    }
}
