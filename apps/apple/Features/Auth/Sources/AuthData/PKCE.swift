import CryptoKit
import Foundation
import Security

/// Proof Key for Code Exchange (RFC 7636), `S256` only: the `plain` method is
/// never offered. Pure and platform-API-only (CryptoKit + `SecRandomCopyBytes`),
/// so it is unit-tested against the RFC's own example vector.
enum PKCE {
    struct Failure: Error, Equatable {
        let status: Int32
    }

    /// 32 random octets encode to 43 base64url characters, the minimum length RFC 7636
    /// section 4.1 allows (43...128) and 256 bits of entropy.
    static let verifierByteCount = 32

    /// A fresh `code_verifier`: unreserved characters only (`A-Z a-z 0-9 - _`).
    static func makeVerifier() throws -> String {
        try randomToken(byteCount: verifierByteCount)
    }

    /// `BASE64URL-ENCODE(SHA256(ASCII(code_verifier)))`, no padding.
    static func challenge(for verifier: String) -> String {
        base64URL(Data(SHA256.hash(data: Data(verifier.utf8))))
    }

    /// Unguessable URL-safe string for `state` and `nonce` (also the verifier).
    static func randomToken(byteCount: Int = 32) throws -> String {
        var bytes = [UInt8](repeating: 0, count: byteCount)
        let status = SecRandomCopyBytes(kSecRandomDefault, byteCount, &bytes)
        guard status == errSecSuccess else { throw Failure(status: status) }
        return base64URL(Data(bytes))
    }

    static func base64URL(_ data: Data) -> String {
        data.base64EncodedString()
            .replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
    }
}
