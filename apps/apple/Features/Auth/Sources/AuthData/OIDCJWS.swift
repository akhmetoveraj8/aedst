import AedstCore
import CryptoKit
import Foundation
import Security

/// The only JWS algorithms an ID token may use (RFC 7518 / RFC 8037). An allow-list, not a
/// deny-list: `none`, every `HS*` (the "alg confusion" family, where the public key would
/// be used as an HMAC secret), `PS*`, `ES384` and anything unknown fail `init?(rawValue:)`.
enum JWSAlgorithm: String, Sendable, CaseIterable {
    case rs256 = "RS256"
    case es256 = "ES256"
    case edDSA = "EdDSA"
}

/// One public signing key from a JWKS (RFC 7517), reduced to the three key types the
/// allow-listed algorithms use. Keys of any other type or curve are dropped at parse time.
struct JSONWebKey: Sendable, Equatable {
    enum Material: Sendable, Equatable {
        case rsa(modulus: Data, exponent: Data)
        /// Affine coordinates, 32 bytes each.
        case p256(x: Data, y: Data)
        case ed25519(publicKey: Data)
    }

    /// Smallest RSA modulus accepted, in bits.
    static let minimumRSAModulusBits = 2048

    let keyID: String?
    /// The optional `alg` member; when present the key may only be used with that algorithm.
    let algorithm: String?
    let material: Material

    /// `nil` for unsupported or malformed keys (and for `use` other than `sig`).
    init?(json object: [String: Any]) {
        guard let keyType = object["kty"] as? String else { return nil }
        if let use = object["use"] as? String, use != "sig" { return nil }

        func bytes(_ name: String) -> Data? {
            (object[name] as? String).flatMap(AccessTokenClaims.decodeBase64URL)
        }

        switch keyType {
        case "RSA":
            guard let modulus = bytes("n"), let exponent = bytes("e") else { return nil }
            let significant = modulus.drop { $0 == 0 }
            guard significant.count * 8 >= Self.minimumRSAModulusBits, significant.count <= 1_024,
                  !exponent.isEmpty, exponent.count <= 8
            else { return nil }
            material = .rsa(modulus: Data(significant), exponent: exponent)
        case "EC":
            guard object["crv"] as? String == "P-256",
                  let x = bytes("x"), let y = bytes("y"), x.count == 32, y.count == 32
            else { return nil }
            material = .p256(x: x, y: y)
        case "OKP":
            guard object["crv"] as? String == "Ed25519", let x = bytes("x"), x.count == 32 else { return nil }
            material = .ed25519(publicKey: x)
        default:
            return nil
        }
        keyID = object["kid"] as? String
        algorithm = object["alg"] as? String
    }

    /// Key type must match the algorithm family (defeats RS256 <-> ES256 confusion) and an
    /// explicit JWK `alg` must agree.
    func supports(_ candidate: JWSAlgorithm) -> Bool {
        if let algorithm, algorithm != candidate.rawValue { return false }
        switch (material, candidate) {
        case (.rsa, .rs256), (.p256, .es256), (.ed25519, .edDSA): return true
        default: return false
        }
    }
}

/// Signature verification with platform crypto only (Security for RSA, CryptoKit for the rest).
enum JWSVerifier {
    /// `signingInput` is the ASCII `base64url(header) "." base64url(payload)` of the compact JWS;
    /// `signature` is the decoded third segment (for ES256: raw `r || s`, 64 bytes, not DER).
    static func isValid(
        signature: Data,
        signingInput: Data,
        algorithm: JWSAlgorithm,
        key: JSONWebKey
    ) -> Bool {
        guard key.supports(algorithm) else { return false }
        switch key.material {
        case .rsa(let modulus, let exponent):
            return verifyRSA(signature: signature, signingInput: signingInput, modulus: modulus, exponent: exponent)
        case .p256(let x, let y):
            guard let publicKey = try? P256.Signing.PublicKey(x963Representation: Data([0x04]) + x + y),
                  let ecdsa = try? P256.Signing.ECDSASignature(rawRepresentation: signature)
            else { return false }
            return publicKey.isValidSignature(ecdsa, for: signingInput)
        case .ed25519(let raw):
            guard let publicKey = try? Curve25519.Signing.PublicKey(rawRepresentation: raw) else { return false }
            return publicKey.isValidSignature(signature, for: signingInput)
        }
    }

    private static func verifyRSA(signature: Data, signingInput: Data, modulus: Data, exponent: Data) -> Bool {
        // PKCS#1 RSAPublicKey ::= SEQUENCE { modulus INTEGER, publicExponent INTEGER }
        let der = DER.sequence(DER.integer(modulus) + DER.integer(exponent))
        let attributes: [CFString: Any] = [
            kSecAttrKeyType: kSecAttrKeyTypeRSA,
            kSecAttrKeyClass: kSecAttrKeyClassPublic,
        ]
        var error: Unmanaged<CFError>?
        guard let secKey = SecKeyCreateWithData(Data(der) as CFData, attributes as CFDictionary, &error) else {
            return false
        }
        return SecKeyVerifySignature(
            secKey,
            .rsaSignatureMessagePKCS1v15SHA256,
            signingInput as CFData,
            signature as CFData,
            &error
        )
    }
}

/// Minimal DER writer for the one structure needed (an RSA public key). Foundation and
/// Security have no JWK-to-`SecKey` bridge.
enum DER {
    static func length(_ count: Int) -> [UInt8] {
        switch count {
        case ..<0x80: [UInt8(count)]
        case ..<0x100: [0x81, UInt8(count)]
        default: [0x82, UInt8((count >> 8) & 0xFF), UInt8(count & 0xFF)]
        }
    }

    /// Unsigned big-endian bytes -> DER INTEGER (leading zeros stripped, sign byte added).
    static func integer(_ unsigned: Data) -> [UInt8] {
        var bytes = Array(unsigned.drop { $0 == 0 })
        if bytes.isEmpty { bytes = [0] }
        if let first = bytes.first, first & 0x80 != 0 { bytes.insert(0, at: 0) }
        return [0x02] + length(bytes.count) + bytes
    }

    static func sequence(_ content: [UInt8]) -> [UInt8] {
        [0x30] + length(content.count) + content
    }
}

/// Equality that does not stop at the first differing byte, for values an attacker can probe
/// (`state`, `nonce`, `at_hash`). Length differences are folded in, not early-returned.
enum ConstantTime {
    static func equals(_ lhs: String, _ rhs: String) -> Bool {
        let left = Array(lhs.utf8)
        let right = Array(rhs.utf8)
        var difference = left.count ^ right.count
        for index in 0..<max(left.count, right.count) {
            let l = index < left.count ? left[index] : 0
            let r = index < right.count ? right[index] : 0
            difference |= Int(l ^ r)
        }
        return difference == 0
    }
}
