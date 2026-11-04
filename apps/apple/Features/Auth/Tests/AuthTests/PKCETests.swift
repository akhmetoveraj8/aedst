import Foundation
import Testing
@testable import Auth

@Suite("PKCE")
struct PKCETests {
    @Test("S256 challenge matches the RFC 7636 appendix B vector")
    func rfcVector() {
        let verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"
        #expect(PKCE.challenge(for: verifier) == "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM")
    }

    @Test("verifiers are 43-128 unreserved characters and never repeat")
    func verifierShapeAndUniqueness() throws {
        let allowed = Set("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~")
        var seen = Set<String>()
        for _ in 0..<50 {
            let verifier = try PKCE.makeVerifier()
            #expect((43...128).contains(verifier.count))
            #expect(verifier.allSatisfy { allowed.contains($0) })
            #expect(!verifier.contains("="), "no base64 padding")
            seen.insert(verifier)
        }
        #expect(seen.count == 50)
    }

    @Test("state and nonce tokens are URL-safe and distinct")
    func randomTokens() throws {
        let first = try PKCE.randomToken()
        let second = try PKCE.randomToken()
        #expect(first != second)
        #expect(!first.contains("+") && !first.contains("/") && !first.contains("="))
    }
}
