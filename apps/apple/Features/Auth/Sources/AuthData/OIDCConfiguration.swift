import Foundation

/// Identity-provider settings for browser sign-in (Authorization Code + PKCE),
/// read from `Info.plist` keys that `Config/Base.xcconfig` fills in:
///
/// | Key | Meaning |
/// |---|---|
/// | `AEDST_OIDC_ISSUER` | Issuer URL. Required: empty leaves sign-in unconfigured (`AppDependencies` then uses a placeholder that cannot sign in). |
/// | `AEDST_OIDC_CLIENT_ID` | Public client id of the Native application (no secret, PKCE only). |
/// | `AEDST_OIDC_SCOPES` | Space-separated; default `openid profile email offline_access`. |
/// | `AEDST_OIDC_AUDIENCE_SCOPE` | Optional extra scope, e.g. ZITADEL `urn:zitadel:iam:org:project:id:<id>:aud`. |
/// | `AEDST_OIDC_REDIRECT_SCHEME` | Custom URL scheme of the redirect URI; default `com.aedst.apple`. |
/// | `AEDST_OIDC_REFRESH_TTL_DAYS` | Fallback refresh-token lifetime, see `refreshTokenFallbackTTL`. |
/// | `AEDST_OIDC_EPHEMERAL_SESSION` | `YES` = private browser session for sign-in (default `NO`: shared session, SSO and passkeys). |
///
/// The redirect URI is `<scheme>:/oauth2redirect`; register exactly that string at the IdP.
public struct OIDCConfiguration: Sendable, Equatable {
    public static let defaultScopes = ["openid", "profile", "email", "offline_access"]
    public static let defaultRedirectScheme = "com.aedst.apple"
    public static let defaultRefreshTokenTTLDays = 30
    public static let redirectPath = "/oauth2redirect"

    /// Exactly as configured. Discovery requires the provider document's `issuer`
    /// to be byte-for-byte equal to this (OIDC Discovery 1.0 section 4.3).
    public let issuer: String
    public let clientID: String
    /// Always contains `openid`, no duplicates, order preserved.
    public let scopes: [String]
    public let redirectScheme: String
    /// Refresh tokens from ZITADEL (and Keycloak) carry no lifetime in the token
    /// response, so the client cannot know when one really expires. The stored
    /// `refreshTokenExpiresAt` is `now + this` at every sign-in and refresh; it only
    /// lets the app skip a hopeless refresh and show the sign-in screen offline.
    /// The authoritative expiry is the IdP's `invalid_grant` answer on refresh.
    public let refreshTokenFallbackTTL: TimeInterval
    /// `http://` is accepted for `localhost`, `127.0.0.1` and `[::1]` only, and only
    /// when this is `true` (Debug builds). Release builds require `https://`.
    public let allowsLoopbackHTTP: Bool
    /// Sign-in runs in a private browser session (`prefersEphemeralWebBrowserSession`): no cookies shared with Safari, so
    /// no IdP session survives the app's sign-out (the app does not call `end_session`). Costs SSO and saved passkeys.
    public let prefersEphemeralBrowserSession: Bool

    public var redirectURI: String { "\(redirectScheme):\(Self.redirectPath)" }
    public var scopeString: String { scopes.joined(separator: " ") }

    /// `nil` when the values cannot describe a usable provider (blank issuer or
    /// client id, issuer that is not an `https` URL, malformed scheme).
    public init?(
        issuer: String,
        clientID: String,
        scopes: [String] = OIDCConfiguration.defaultScopes,
        audienceScope: String? = nil,
        redirectScheme: String = OIDCConfiguration.defaultRedirectScheme,
        refreshTokenFallbackTTLDays: Int = OIDCConfiguration.defaultRefreshTokenTTLDays,
        allowsLoopbackHTTP: Bool = false,
        prefersEphemeralBrowserSession: Bool = false
    ) {
        let issuer = issuer.trimmingCharacters(in: .whitespacesAndNewlines)
        let clientID = clientID.trimmingCharacters(in: .whitespacesAndNewlines)
        let scheme = redirectScheme.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()

        guard !issuer.isEmpty, !clientID.isEmpty,
              let issuerURL = URL(string: issuer),
              issuerURL.query == nil, issuerURL.fragment == nil,
              Self.isAcceptableEndpoint(issuerURL, allowsLoopbackHTTP: allowsLoopbackHTTP),
              Self.isValidScheme(scheme)
        else { return nil }

        var merged = ["openid"]
        for scope in scopes + (audienceScope.map { [$0] } ?? []) {
            let scope = scope.trimmingCharacters(in: .whitespacesAndNewlines)
            if !scope.isEmpty, !merged.contains(scope) { merged.append(scope) }
        }

        self.issuer = issuer
        self.clientID = clientID
        self.scopes = merged
        self.redirectScheme = scheme
        self.refreshTokenFallbackTTL = TimeInterval(max(1, refreshTokenFallbackTTLDays)) * 86_400
        self.allowsLoopbackHTTP = allowsLoopbackHTTP
        self.prefersEphemeralBrowserSession = prefersEphemeralBrowserSession
    }

    /// Placeholder for builds without an identity provider (forks, hermetic UI tests): `.invalid` is a reserved
    /// TLD (RFC 2606), so discovery fails and sign-in shows an error; it never reaches a real provider.
    public static let unconfigured: OIDCConfiguration = {
        guard let configuration = OIDCConfiguration(issuer: "https://idp.invalid", clientID: "unconfigured") else {
            preconditionFailure("the placeholder issuer is a valid https URL")
        }
        return configuration
    }()

    /// Reads the `AEDST_OIDC_*` Info.plist keys. `nil` when the
    /// issuer or client id is empty or unsubstituted (sign-in is then unconfigured).
    public static func fromBundle(_ bundle: Bundle = .main) -> OIDCConfiguration? {
        #if DEBUG
        let allowsLoopbackHTTP = true
        #else
        let allowsLoopbackHTTP = false
        #endif
        return resolve(
            infoValue: { bundle.object(forInfoDictionaryKey: $0) as? String },
            allowsLoopbackHTTP: allowsLoopbackHTTP
        )
    }

    /// Pure resolution logic (unit-tested): an unset xcconfig variable arrives as
    /// an empty string, or as the literal `$(NAME)` when it was never defined.
    static func resolve(
        infoValue: (String) -> String?,
        allowsLoopbackHTTP: Bool
    ) -> OIDCConfiguration? {
        func value(_ key: String) -> String? {
            guard let raw = infoValue(key)?.trimmingCharacters(in: .whitespacesAndNewlines),
                  !raw.isEmpty, !raw.hasPrefix("$(")
            else { return nil }
            return raw
        }

        guard let issuer = value("AEDST_OIDC_ISSUER"), let clientID = value("AEDST_OIDC_CLIENT_ID") else {
            return nil
        }
        let scopes = value("AEDST_OIDC_SCOPES").map { raw in
            raw.split(whereSeparator: \.isWhitespace).map(String.init)
        } ?? defaultScopes
        return OIDCConfiguration(
            issuer: issuer,
            clientID: clientID,
            scopes: scopes,
            audienceScope: value("AEDST_OIDC_AUDIENCE_SCOPE"),
            redirectScheme: value("AEDST_OIDC_REDIRECT_SCHEME") ?? defaultRedirectScheme,
            refreshTokenFallbackTTLDays: value("AEDST_OIDC_REFRESH_TTL_DAYS").flatMap { Int($0) }
                ?? defaultRefreshTokenTTLDays,
            allowsLoopbackHTTP: allowsLoopbackHTTP,
            prefersEphemeralBrowserSession: value("AEDST_OIDC_EPHEMERAL_SESSION").map {
                ["yes", "true", "1"].contains($0.lowercased())
            } ?? false
        )
    }

    /// `https` with a host, or `http` to a loopback host when `allowsLoopbackHTTP`.
    public func isAcceptableEndpoint(_ url: URL) -> Bool {
        Self.isAcceptableEndpoint(url, allowsLoopbackHTTP: allowsLoopbackHTTP)
    }

    static func isAcceptableEndpoint(_ url: URL, allowsLoopbackHTTP: Bool) -> Bool {
        guard let host = url.host, !host.isEmpty else { return false }
        switch url.scheme?.lowercased() {
        case "https":
            return true
        case "http":
            return allowsLoopbackHTTP && ["localhost", "127.0.0.1", "::1"].contains(host.lowercased())
        default:
            return false
        }
    }

    /// RFC 3986 scheme: ALPHA *( ALPHA / DIGIT / "+" / "-" / "." ).
    private static func isValidScheme(_ scheme: String) -> Bool {
        guard let first = scheme.first, first.isASCII, first.isLetter else { return false }
        return scheme.allSatisfy { character in
            character.isASCII && (character.isLetter || character.isNumber || "+-.".contains(character))
        }
    }
}
