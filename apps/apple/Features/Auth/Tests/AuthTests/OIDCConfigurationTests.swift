import Foundation
import Testing
@testable import Auth

@Suite("OIDCConfiguration")
struct OIDCConfigurationTests {
    private func resolve(_ values: [String: String], loopback: Bool = false) -> OIDCConfiguration? {
        OIDCConfiguration.resolve(infoValue: { values[$0] }, allowsLoopbackHTTP: loopback)
    }

    @Test("an empty or unsubstituted issuer disables OIDC")
    func emptyIssuerDisables() {
        #expect(resolve([:]) == nil)
        #expect(resolve(["AEDST_OIDC_ISSUER": "", "AEDST_OIDC_CLIENT_ID": "c"]) == nil)
        #expect(resolve(["AEDST_OIDC_ISSUER": "$(AEDST_OIDC_ISSUER)", "AEDST_OIDC_CLIENT_ID": "c"]) == nil)
    }

    @Test("an issuer without a client id is not usable")
    func missingClientID() {
        #expect(resolve(["AEDST_OIDC_ISSUER": "https://idp.example.com", "AEDST_OIDC_CLIENT_ID": ""]) == nil)
    }

    @Test("defaults: scopes, redirect URI and refresh-token estimate")
    func defaults() throws {
        let configuration = try #require(resolve([
            "AEDST_OIDC_ISSUER": "https://idp.example.com",
            "AEDST_OIDC_CLIENT_ID": "client-1",
            "AEDST_OIDC_SCOPES": "",
            "AEDST_OIDC_REDIRECT_SCHEME": "$(AEDST_OIDC_REDIRECT_SCHEME)",
        ]))
        #expect(configuration.scopeString == "openid profile email offline_access")
        #expect(configuration.redirectURI == "com.aedst.apple:/oauth2redirect")
        #expect(configuration.refreshTokenFallbackTTL == 30 * 86_400)
    }

    @Test("the private browser session is opt-in")
    func ephemeralSession() throws {
        let base = ["AEDST_OIDC_ISSUER": "https://idp.example.com", "AEDST_OIDC_CLIENT_ID": "client-1"]
        #expect(try #require(resolve(base)).prefersEphemeralBrowserSession == false)
        #expect(try #require(resolve(base.merging(["AEDST_OIDC_EPHEMERAL_SESSION": "NO"]) { $1 })).prefersEphemeralBrowserSession == false)
        #expect(try #require(resolve(base.merging(["AEDST_OIDC_EPHEMERAL_SESSION": "YES"]) { $1 })).prefersEphemeralBrowserSession)
        let unsubstituted = base.merging(["AEDST_OIDC_EPHEMERAL_SESSION": "$(AEDST_OIDC_EPHEMERAL_SESSION)"]) { $1 }
        #expect(try #require(resolve(unsubstituted)).prefersEphemeralBrowserSession == false)
    }

    @Test("audience scope is appended, openid is always present, duplicates collapse")
    func scopes() throws {
        let configuration = try #require(resolve([
            "AEDST_OIDC_ISSUER": "https://idp.example.com",
            "AEDST_OIDC_CLIENT_ID": "client-1",
            "AEDST_OIDC_SCOPES": "profile offline_access profile",
            "AEDST_OIDC_AUDIENCE_SCOPE": "urn:zitadel:iam:org:project:id:42:aud",
            "AEDST_OIDC_REFRESH_TTL_DAYS": "7",
        ]))
        #expect(configuration.scopes == ["openid", "profile", "offline_access", "urn:zitadel:iam:org:project:id:42:aud"])
        #expect(configuration.refreshTokenFallbackTTL == 7 * 86_400)
    }

    @Test("http issuers are accepted for loopback in debug only")
    func plaintextIssuer() {
        let values = ["AEDST_OIDC_ISSUER": "http://localhost:8081", "AEDST_OIDC_CLIENT_ID": "c"]
        #expect(resolve(values, loopback: true) != nil)
        #expect(resolve(values, loopback: false) == nil)
        #expect(resolve(["AEDST_OIDC_ISSUER": "http://idp.example.com", "AEDST_OIDC_CLIENT_ID": "c"], loopback: true) == nil)
    }

    @Test("a malformed redirect scheme is rejected")
    func invalidScheme() {
        #expect(OIDCConfiguration(issuer: "https://idp.example.com", clientID: "c", redirectScheme: "9bad scheme") == nil)
        #expect(OIDCConfiguration(issuer: "https://idp.example.com", clientID: "c", redirectScheme: "Com.Aedst.Apple")?.redirectScheme == "com.aedst.apple")
    }
}
