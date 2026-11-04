import AedstCore
import AedstTesting
import Foundation
import Testing
@testable import Auth

@Suite("OIDCAuthRepository")
struct OIDCAuthRepositoryTests {
    private let issuedAt = OIDCFixtures.now

    private func makeRepository(
        _ stub: StubTransport,
        webAuthenticator: StubWebAuthenticator,
        store: StubTokenProvider = StubTokenProvider()
    ) -> OIDCAuthRepository {
        let (client, discovery) = OIDCFixtures.makeTokenClient(stub)
        return OIDCAuthRepository(
            configuration: OIDCFixtures.configuration,
            discovery: discovery,
            tokenClient: client,
            webAuthenticator: webAuthenticator,
            sessionStore: store,
            clock: ManualClock(now: issuedAt),
            jwksTransport: stub.transport
        )
    }

    /// A token endpoint that echoes back an id_token bound to the nonce of the request the
    /// authenticator saw, like a real provider would.
    private func transport(
        authenticator: StubWebAuthenticator,
        nonceOverride: String? = nil,
        idTokenOverride: (@Sendable (String) -> String)? = nil
    ) -> StubTransport {
        OIDCFixtures.transport(token: { _ in
            let url = authenticator.receivedURLs.last!
            let nonce = nonceOverride ?? OIDCFixtures.queryValue("nonce", in: url) ?? ""
            let idToken = idTokenOverride?(nonce) ?? OIDCFixtures.idToken(nonce: nonce)
            return .init(status: 200, body: OIDCFixtures.tokenJSON(idToken: idToken))
        })
    }

    @Test("sign-in runs PKCE end to end and stores the tokens only through the session store")
    func signInSuccess() async throws {
        let authenticator = StubWebAuthenticator.approving(code: "code-9")
        let stub = transport(authenticator: authenticator)
        let store = StubTokenProvider()
        let repository = makeRepository(stub, webAuthenticator: authenticator, store: store)

        let result = await repository.signIn(deviceID: "device-1")

        #expect(result.value == Session(
            userID: "user-1",
            accessTokenExpiresAt: issuedAt.addingTimeInterval(900),
            refreshTokenExpiresAt: issuedAt.addingTimeInterval(30 * 86_400)
        ))
        #expect(await store.savedTokens?.accessToken == "access-1")
        #expect(await store.savedTokens?.refreshToken == "refresh-1")
        #expect(await store.savedUserID == "user-1")

        // The browser saw the challenge; only the token endpoint saw the verifier.
        let authorizeURL = try #require(authenticator.receivedURLs.first)
        #expect(authenticator.receivedSchemes == ["com.aedst.apple"])
        let form = OIDCFixtures.formFields(of: try #require(stub.requests(toPath: "/oauth/v2/token").first))
        #expect(form["code"] == "code-9")
        let verifier = try #require(form["code_verifier"])
        #expect(OIDCFixtures.queryValue("code_challenge", in: authorizeURL) == PKCE.challenge(for: verifier))
        #expect(!authorizeURL.absoluteString.contains(verifier))
    }

    @Test("a state mismatch is rejected before any token request and nothing is stored")
    func stateMismatch() async {
        let authenticator = StubWebAuthenticator.approving(stateOverride: "forged")
        let stub = transport(authenticator: authenticator)
        let store = StubTokenProvider()
        let repository = makeRepository(stub, webAuthenticator: authenticator, store: store)

        let result = await repository.signIn(deviceID: "d")

        #expect(result.error == .unauthenticated)
        #expect(stub.requests(toPath: "/oauth/v2/token").isEmpty)
        #expect(await store.savedTokens == nil)
    }

    @Test("a cancelled sign-in is .cancelled: no token request, nothing stored")
    func cancelled() async {
        let authenticator = StubWebAuthenticator.failing(.cancelled)
        let stub = OIDCFixtures.transport()
        let store = StubTokenProvider()
        let repository = makeRepository(stub, webAuthenticator: authenticator, store: store)

        let result = await repository.signIn(deviceID: "d")

        #expect(result.error == .cancelled)
        #expect(stub.requests(toPath: "/oauth/v2/token").isEmpty)
        #expect(await store.savedTokens == nil)
    }

    @Test("a browser failure other than cancellation is an error")
    func browserFailure() async {
        let repository = makeRepository(
            OIDCFixtures.transport(),
            webAuthenticator: .failing(.failed(reason: "no browser"))
        )

        let result = await repository.signIn(deviceID: "d")

        #expect(result.error == .unknown(reason: "no browser"))
    }

    @Test("a token response without an id_token fails closed and nothing is stored")
    func missingIDTokenFailsClosed() async {
        let authenticator = StubWebAuthenticator.approving()
        let stub = OIDCFixtures.transport(token: { _ in .init(status: 200, body: OIDCFixtures.tokenJSON()) })
        let store = StubTokenProvider()
        let repository = makeRepository(stub, webAuthenticator: authenticator, store: store)

        let result = await repository.signIn(deviceID: "d")

        #expect(result.error == .unauthenticated)
        #expect(await store.savedTokens == nil)
    }

    @Test("an id_token whose nonce does not match is rejected and nothing is stored")
    func nonceMismatch() async {
        let authenticator = StubWebAuthenticator.approving()
        let stub = transport(authenticator: authenticator, nonceOverride: "replayed")
        let store = StubTokenProvider()
        let repository = makeRepository(stub, webAuthenticator: authenticator, store: store)

        let result = await repository.signIn(deviceID: "d")

        #expect(result.error == .unauthenticated)
        #expect(await store.savedTokens == nil)
    }

    @Test("an id_token for another audience or issuer is rejected")
    func wrongAudienceOrIssuer() async {
        let builders: [@Sendable (String) -> String] = [
            { nonce in OIDCFixtures.idToken(nonce: nonce, audience: "other-client") },
            { nonce in OIDCFixtures.idToken(nonce: nonce, issuer: "https://evil.example.com") },
            { nonce in OIDCFixtures.idToken(nonce: nonce, expiresAt: OIDCFixtures.now.addingTimeInterval(-3_600)) },
        ]
        for build in builders {
            let authenticator = StubWebAuthenticator.approving()
            let store = StubTokenProvider()
            let repository = makeRepository(
                transport(authenticator: authenticator, idTokenOverride: build),
                webAuthenticator: authenticator,
                store: store
            )

            #expect(await repository.signIn(deviceID: "d").error == .unauthenticated)
            #expect(await store.savedTokens == nil)
        }
    }

    @Test("an id_token signed by a key the provider does not publish is rejected and nothing is stored")
    func forgedSignature() async {
        let attacker = TestSigningKey.p256(keyID: "key-1") // same kid, different key material
        let authenticator = StubWebAuthenticator.approving()
        let store = StubTokenProvider()
        let repository = makeRepository(
            transport(authenticator: authenticator, idTokenOverride: { nonce in
                OIDCFixtures.idToken(nonce: nonce, key: attacker)
            }),
            webAuthenticator: authenticator,
            store: store
        )

        #expect(await repository.signIn(deviceID: "d").error == .unauthenticated)
        #expect(await store.savedTokens == nil)
    }

    @Test("a discovery document without jwks_uri fails closed")
    func noJWKS() async {
        let authenticator = StubWebAuthenticator.approving()
        let stub = OIDCFixtures.transport(
            token: { _ in
                let nonce = OIDCFixtures.queryValue("nonce", in: authenticator.receivedURLs.last!) ?? ""
                return .init(status: 200, body: OIDCFixtures.tokenJSON(idToken: OIDCFixtures.idToken(nonce: nonce)))
            },
            discovery: .init(status: 200, body: OIDCFixtures.discoveryJSON(jwks: false))
        )
        let store = StubTokenProvider()
        let repository = makeRepository(stub, webAuthenticator: authenticator, store: store)

        let result = await repository.signIn(deviceID: "d")

        guard case .failure(.decoding) = result else {
            Issue.record("expected .decoding, got \(result)")
            return
        }
        #expect(await store.savedTokens == nil)
    }

    @Test("a rejected code (invalid_grant) fails sign-in without storing anything")
    func codeRejected() async {
        let authenticator = StubWebAuthenticator.approving()
        let stub = OIDCFixtures.transport(token: { _ in .init(status: 400, body: #"{"error":"invalid_grant"}"#) })
        let store = StubTokenProvider()
        let repository = makeRepository(stub, webAuthenticator: authenticator, store: store)

        #expect(await repository.signIn(deviceID: "d").error == .unauthenticated)
        #expect(await store.savedTokens == nil)
    }

    @Test("without a refresh token (offline_access not granted) sign-in fails")
    func noRefreshToken() async {
        let authenticator = StubWebAuthenticator.approving()
        let stub = OIDCFixtures.transport(token: { _ in
            let nonce = OIDCFixtures.queryValue("nonce", in: authenticator.receivedURLs.last!) ?? ""
            return .init(status: 200, body: OIDCFixtures.tokenJSON(refreshToken: nil, idToken: OIDCFixtures.idToken(nonce: nonce)))
        })
        let store = StubTokenProvider()
        let repository = makeRepository(stub, webAuthenticator: authenticator, store: store)

        let result = await repository.signIn(deviceID: "d")

        guard case .failure(.decoding) = result else {
            Issue.record("expected .decoding, got \(result)")
            return
        }
        #expect(await store.savedTokens == nil)
    }

    @Test("logout revokes the refresh token, then clears the local session")
    func logoutRevokesThenClears() async throws {
        let stub = OIDCFixtures.transport()
        let store = StubTokenProvider()
        try await store.save(
            TokenPair(
                accessToken: "a",
                refreshToken: "r-live",
                accessTokenExpiresAt: .distantFuture,
                refreshTokenExpiresAt: .distantFuture
            ),
            userID: "user-1"
        )
        let repository = makeRepository(stub, webAuthenticator: .approving(), store: store)

        let result = await repository.logout()

        #expect(result.error == nil)
        let revokes = stub.requests(toPath: "/oauth/v2/revoke")
        #expect(revokes.count == 1)
        #expect(OIDCFixtures.formFields(of: try #require(revokes.first))["token"] == "r-live")
        #expect(await store.didClearTokens)
    }

    @Test("logout clears the local session even when revocation fails")
    func logoutClearsWhenRevocationFails() async throws {
        let stub = OIDCFixtures.transport(revoke: .init(status: 500, body: ""))
        let store = StubTokenProvider()
        try await store.save(
            TokenPair(
                accessToken: "a",
                refreshToken: "r-live",
                accessTokenExpiresAt: .distantFuture,
                refreshTokenExpiresAt: .distantFuture
            ),
            userID: "user-1"
        )
        let repository = makeRepository(stub, webAuthenticator: .approving(), store: store)

        let result = await repository.logout()

        #expect(result.error == nil)
        #expect(stub.requests(toPath: "/oauth/v2/revoke").count == 1)
        #expect(await store.didClearTokens)
    }

    @Test("currentSession hides a session whose refresh token has expired")
    func currentSession() async throws {
        let store = StubTokenProvider()
        try await store.save(
            TokenPair(
                accessToken: "a",
                refreshToken: "r",
                accessTokenExpiresAt: issuedAt,
                refreshTokenExpiresAt: issuedAt.addingTimeInterval(10)
            ),
            userID: "user-1"
        )
        let repository = makeRepository(OIDCFixtures.transport(), webAuthenticator: .approving(), store: store)

        #expect(await repository.currentSession()?.userID == "user-1")
        let late = OIDCAuthRepository(
            configuration: OIDCFixtures.configuration,
            discovery: OIDCFixtures.makeTokenClient(OIDCFixtures.transport()).discovery,
            tokenClient: OIDCFixtures.makeTokenClient(OIDCFixtures.transport()).client,
            webAuthenticator: StubWebAuthenticator.approving(),
            sessionStore: store,
            clock: ManualClock(now: issuedAt.addingTimeInterval(11))
        )
        #expect(await late.currentSession() == nil)
    }
}
