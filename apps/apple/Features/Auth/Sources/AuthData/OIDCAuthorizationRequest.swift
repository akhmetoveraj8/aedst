import AedstCore
import Foundation

/// One authorization request (RFC 6749 section 4.1.1 + RFC 7636 + OIDC Core): the URL to
/// open in the browser session and the secrets that must come back unchanged.
/// Created per sign-in attempt, never persisted.
struct OIDCAuthorizationRequest: Equatable {
    let url: URL
    let state: String
    let nonce: String
    /// Sent only to the token endpoint, never in the browser URL.
    let codeVerifier: String

    /// Builds the request with fresh random `state`, `nonce` and `code_verifier`.
    static func make(configuration: OIDCConfiguration, metadata: OIDCProviderMetadata) throws -> OIDCAuthorizationRequest {
        let state = try PKCE.randomToken()
        let nonce = try PKCE.randomToken()
        let verifier = try PKCE.makeVerifier()
        guard let request = OIDCAuthorizationRequest(
            configuration: configuration,
            metadata: metadata,
            state: state,
            nonce: nonce,
            codeVerifier: verifier
        ) else {
            throw BuildError()
        }
        return request
    }

    /// The authorization endpoint could not carry the query.
    struct BuildError: Error {}

    /// Deterministic variant for tests. `nil` when the endpoint URL cannot take a query.
    init?(
        configuration: OIDCConfiguration,
        metadata: OIDCProviderMetadata,
        state: String,
        nonce: String,
        codeVerifier: String
    ) {
        guard var components = URLComponents(url: metadata.authorizationEndpoint, resolvingAgainstBaseURL: false) else {
            return nil
        }
        // Keep any query the provider put on the endpoint, then add ours.
        components.queryItems = (components.queryItems ?? []) + [
            URLQueryItem(name: "response_type", value: "code"),
            URLQueryItem(name: "client_id", value: configuration.clientID),
            URLQueryItem(name: "redirect_uri", value: configuration.redirectURI),
            URLQueryItem(name: "scope", value: configuration.scopeString),
            URLQueryItem(name: "state", value: state),
            URLQueryItem(name: "nonce", value: nonce),
            URLQueryItem(name: "code_challenge", value: PKCE.challenge(for: codeVerifier)),
            // S256 only: `plain` is never offered.
            URLQueryItem(name: "code_challenge_method", value: "S256"),
        ]
        guard let url = components.url else { return nil }
        self.url = url
        self.state = state
        self.nonce = nonce
        self.codeVerifier = codeVerifier
    }

    /// Extracts the authorization code from the redirect, after checking that the redirect is
    /// ours (`state` equal, expected redirect path). A user denying consent is `.cancelled`.
    func authorizationCode(from callback: URL, configuration: OIDCConfiguration) -> Outcome<String> {
        guard let components = URLComponents(url: callback, resolvingAgainstBaseURL: false),
              components.scheme?.lowercased() == configuration.redirectScheme,
              components.path == OIDCConfiguration.redirectPath
        else {
            return .failure(.unauthenticated)
        }
        let items = components.queryItems ?? []
        func value(_ name: String) -> String? { items.first { $0.name == name }?.value }

        // CSRF / mix-up defence: the state we generated must come back, on errors too.
        guard let returnedState = value("state"), ConstantTime.equals(returnedState, state) else {
            return .failure(.unauthenticated)
        }
        if let error = value("error") {
            return .failure(error == "access_denied" ? .cancelled : .unknown(reason: "authorization error \(error)"))
        }
        guard let code = value("code"), !code.isEmpty else {
            return .failure(.decoding(reason: "redirect carried no authorization code"))
        }
        return .success(code)
    }
}
