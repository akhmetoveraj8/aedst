import Foundation
import Testing
@testable import AedstCore

@Suite("AccessTokenClaims")
struct AccessTokenClaimsTests {
    private func jwt(_ payload: String) -> String {
        let encoded = Data(payload.utf8).base64EncodedString()
            .replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
        return "eyJhbGciOiJub25lIn0.\(encoded).signature"
    }

    @Test("reads sub, exp and a top-level roles array")
    func topLevelRoles() throws {
        let claims = try #require(AccessTokenClaims(jwt: jwt(#"{"sub":"u1","exp":1700000000,"roles":["admin","user"]}"#)))
        #expect(claims.subject == "u1")
        #expect(claims.expiresAt == Date(timeIntervalSince1970: 1_700_000_000))
        #expect(claims.hasRole("admin"))
    }

    @Test("follows a dotted path (Keycloak realm_access.roles)")
    func dottedPath() throws {
        let token = jwt(#"{"realm_access":{"roles":["admin"]}}"#)
        let claims = try #require(AccessTokenClaims(jwt: token, rolesClaim: "realm_access.roles"))
        #expect(claims.roles == ["admin"])
    }

    @Test("understands object-keyed and space-separated roles")
    func otherShapes() throws {
        let object = try #require(AccessTokenClaims(jwt: jwt(#"{"roles":{"admin":{}}}"#)))
        #expect(object.hasRole("admin"))
        let spaced = try #require(AccessTokenClaims(jwt: jwt(#"{"roles":"admin user"}"#)))
        #expect(spaced.roles == ["admin", "user"])
    }

    @Test("rejects a token without a readable payload")
    func garbage() {
        #expect(AccessTokenClaims(jwt: "not-a-jwt") == nil)
        #expect(AccessTokenClaims(jwt: "a.!!!.c") == nil)
    }
}
