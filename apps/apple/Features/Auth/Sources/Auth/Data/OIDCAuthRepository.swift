import AedstCore
import Foundation

/// Turns the provider's answer to `grant_type=refresh_token` into the tri-state the session
/// store understands. This is the `refreshHandler` given to `KeychainTokenStore`.
///
/// - `invalid_grant` (the refresh token is expired, revoked or was reused) -> `.rejected`:
///   the session ends and the user signs in again.
/// - Anything else (offline, timeout, 429, 5xx, a misconfigured client, an unreadable
///   response) -> `.unavailable`: the session is kept and the next 401 tries again, so an
///   outage or a deployment mistake never signs every user out.
///
/// There is intentionally **no automatic retry**: the provider rotates refresh tokens and
/// detects reuse, so replaying a request whose response was lost would present an
/// already-rotated token and revoke the whole token family.
public struct OIDCTokenRefresher: Sendable {
    private let tokenClient: any OIDCTokenClient
    private let configuration: OIDCConfiguration
    private let clock: any AedstClock

    public init(
        tokenClient: any OIDCTokenClient,
        configuration: OIDCConfiguration,
        clock: any AedstClock = SystemClock()
    ) {
        self.tokenClient = tokenClient
        self.configuration = configuration
        self.clock = clock
    }

    public func refresh(refreshToken: String) async -> RefreshResult {
        switch await tokenClient.refresh(refreshToken: refreshToken) {
        case .success(let response):
            guard let pair = response.tokenPair(
                issuedAt: clock.now,
                previousRefreshToken: refreshToken,
                refreshTTL: configuration.refreshTokenFallbackTTL
            ) else {
                return .unavailable
            }
            return .refreshed(pair)
        case .failure(.unauthenticated):
            return .rejected
        case .failure:
            return .unavailable
        }
    }
}

/// `AuthRepository` for browser sign-in: Authorization Code + PKCE against the identity
/// provider via `WebAuthenticator`, with tokens written through `SessionStore` (Keychain)
/// and nowhere else. The only place in OIDC mode that stores tokens.
///
/// Passkeys: the IdP's hosted login (ZITADEL) runs WebAuthn inside the browser session. This
/// app does not run WebAuthn ceremonies itself (`ASAuthorizationPlatformPublicKeyCredentialProvider`
/// is deliberately unused): that would be self-built identity. Revisit if a fully native login
/// UI is required, by driving ZITADEL's Session API instead of the hosted page.
public struct OIDCAuthRepository: AuthRepository {
    private let configuration: OIDCConfiguration
    private let discovery: OIDCDiscovery
    private let tokenClient: any OIDCTokenClient
    private let webAuthenticator: any WebAuthenticator
    private let sessionStore: any SessionStore
    private let clock: any AedstClock
    private let idTokenVerifier: IDTokenVerifier
    private let signposter = AedstSignposter(category: "auth")
    private let logger = AedstLogger(category: "oidc")

    /// `jwksTransport` fetches the provider's signing keys (ID token signature verification);
    /// tests inject a stub, production uses the ephemeral session.
    public init(
        configuration: OIDCConfiguration,
        discovery: OIDCDiscovery,
        tokenClient: any OIDCTokenClient,
        webAuthenticator: any WebAuthenticator,
        sessionStore: any SessionStore,
        clock: any AedstClock = SystemClock(),
        jwksTransport: @escaping OIDCTransport = OIDCTransports.default
    ) {
        self.idTokenVerifier = IDTokenVerifier(
            keySet: OIDCKeySet(discovery: discovery, transport: jwksTransport, clock: clock)
        )
        self.configuration = configuration
        self.discovery = discovery
        self.tokenClient = tokenClient
        self.webAuthenticator = webAuthenticator
        self.sessionStore = sessionStore
        self.clock = clock
    }

    /// `deviceID` is unused: the IdP tracks its own sessions.
    public func signIn(deviceID: String) async -> Outcome<Session> {
        await signposter.measure("oidcSignIn") {
            await performSignIn()
        }
    }

    public func logout() async -> Outcome<Void> {
        if let refreshToken = await sessionStore.currentRefreshToken() {
            // Best effort (RFC 7009): local sign-out must not depend on the network. The IdP's browser session is
            // not ended here (that needs a second system sheet at sign-out): `AEDST_OIDC_EPHEMERAL_SESSION=YES`
            // makes sign-in use a private browser session instead, so nothing outlives the app's sign-out.
            // See decisions/apple.md, "OIDC browser session".
            if case .failure(let error) = await tokenClient.revoke(refreshToken: refreshToken) {
                logger.info("Refresh token revocation did not complete (\(error.analyticsCategory))")
            }
        }
        await sessionStore.clearTokens()
        return .success(())
    }

    public func currentSession() async -> Session? {
        guard let snapshot = await sessionStore.currentSession() else { return nil }
        let session = Session(
            userID: snapshot.userID,
            accessTokenExpiresAt: snapshot.accessTokenExpiresAt,
            refreshTokenExpiresAt: snapshot.refreshTokenExpiresAt
        )
        // An expired *access* token refreshes on demand; an expired (estimated) refresh
        // token means signed out. The IdP's `invalid_grant` is the real authority.
        return session.isRefreshTokenExpired(at: clock.now) ? nil : session
    }

    private func performSignIn() async -> Outcome<Session> {
        let metadata: OIDCProviderMetadata
        switch await discovery.metadata() {
        case .success(let value): metadata = value
        case .failure(let error): return .failure(error)
        }

        let request: OIDCAuthorizationRequest
        do {
            request = try OIDCAuthorizationRequest.make(configuration: configuration, metadata: metadata)
        } catch {
            logger.error("Could not build the authorization request", error: error)
            return .failure(.unknown(reason: "authorization request could not be built"))
        }

        let callback: URL
        do {
            callback = try await webAuthenticator.authenticate(url: request.url, callbackScheme: configuration.redirectScheme)
        } catch WebAuthenticationError.cancelled {
            return .failure(.cancelled)
        } catch WebAuthenticationError.failed(let reason) {
            return .failure(.unknown(reason: reason))
        } catch {
            return .failure(.unknown(reason: String(describing: error)))
        }

        let code: String
        switch request.authorizationCode(from: callback, configuration: configuration) {
        case .success(let value): code = value
        case .failure(let error): return .failure(error)
        }

        let response: OIDCTokenResponse
        switch await tokenClient.exchangeCode(code, codeVerifier: request.codeVerifier) {
        case .success(let value): response = value
        case .failure(let error): return .failure(error)
        }

        let now = clock.now
        guard let tokens = response.tokenPair(
            issuedAt: now,
            previousRefreshToken: nil,
            refreshTTL: configuration.refreshTokenFallbackTTL
        ) else {
            return .failure(.decoding(reason: "no refresh token issued; is offline_access granted?"))
        }

        let userID: String
        switch await userID(of: response, nonce: request.nonce, now: now) {
        case .success(let value): userID = value
        case .failure(let error): return .failure(error)
        }

        do {
            try await sessionStore.save(tokens, userID: userID)
        } catch {
            logger.error("Signed in but the session could not be stored", error: error)
            return .failure(.storage(reason: String(describing: error)))
        }
        return .success(
            Session(
                userID: userID,
                accessTokenExpiresAt: tokens.accessTokenExpiresAt,
                refreshTokenExpiresAt: tokens.refreshTokenExpiresAt
            )
        )
    }

    /// `sub` from the verified ID token (signature, issuer, audience, nonce, expiry). A token response without an
    /// `id_token` fails closed: the nonce check is what binds this response to the request this app started, so a
    /// response that skips it (a downgraded or injected one) must not create a session, whatever its access token says.
    private func userID(
        of response: OIDCTokenResponse,
        nonce: String,
        now: Date
    ) async -> Outcome<String> {
        guard let idToken = response.idToken else {
            return .failure(.unauthenticated)
        }
        return await idTokenVerifier.subject(
            ofIDToken: idToken,
            issuer: configuration.issuer,
            clientID: configuration.clientID,
            expectedNonce: nonce,
            accessToken: response.accessToken,
            now: now
        )
    }
}
