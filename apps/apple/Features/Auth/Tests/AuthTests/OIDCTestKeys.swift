import AedstCore
import CryptoKit
import Foundation
import Security
@testable import Auth

/// A throw-away signing key generated per test run (no key material is committed), able to
/// sign JWTs and to publish its public half as a JWK. UNVERIFIED: written without a Swift
/// toolchain; the first CI run is its acceptance test.
final class TestSigningKey: @unchecked Sendable {
    let algorithm: String
    let keyID: String
    let publicJWK: [String: Any]
    private let signer: @Sendable (Data) -> Data

    private init(algorithm: String, keyID: String, publicJWK: [String: Any], signer: @escaping @Sendable (Data) -> Data) {
        self.algorithm = algorithm
        self.keyID = keyID
        self.publicJWK = publicJWK
        self.signer = signer
    }

    func sign(_ signingInput: Data) -> Data { signer(signingInput) }

    // MARK: Factories

    static func p256(keyID: String) -> TestSigningKey {
        let key = P256.Signing.PrivateKey()
        let point = key.publicKey.x963Representation // 0x04 || x || y
        let jwk: [String: Any] = [
            "kty": "EC", "crv": "P-256", "kid": keyID, "use": "sig", "alg": "ES256",
            "x": PKCE.base64URL(point.subdata(in: 1..<33)),
            "y": PKCE.base64URL(point.subdata(in: 33..<65)),
        ]
        return TestSigningKey(algorithm: "ES256", keyID: keyID, publicJWK: jwk) { input in
            // JWS wants raw r || s, which is exactly `rawRepresentation`.
            (try? key.signature(for: input).rawRepresentation) ?? Data()
        }
    }

    static func ed25519(keyID: String) -> TestSigningKey {
        let key = Curve25519.Signing.PrivateKey()
        let jwk: [String: Any] = [
            "kty": "OKP", "crv": "Ed25519", "kid": keyID, "use": "sig",
            "x": PKCE.base64URL(key.publicKey.rawRepresentation),
        ]
        return TestSigningKey(algorithm: "EdDSA", keyID: keyID, publicJWK: jwk) { input in
            (try? key.signature(for: input)) ?? Data()
        }
    }

    static func rsa(keyID: String) -> TestSigningKey {
        let attributes: [CFString: Any] = [
            kSecAttrKeyType: kSecAttrKeyTypeRSA,
            kSecAttrKeySizeInBits: 2048,
        ]
        var error: Unmanaged<CFError>?
        guard let privateKey = SecKeyCreateRandomKey(attributes as CFDictionary, &error),
              let publicKey = SecKeyCopyPublicKey(privateKey),
              let der = SecKeyCopyExternalRepresentation(publicKey, &error) as Data?,
              let (modulus, exponent) = RSAPublicKeyDER.parse(der)
        else {
            fatalError("could not generate a test RSA key")
        }
        let jwk: [String: Any] = [
            "kty": "RSA", "kid": keyID, "use": "sig", "alg": "RS256",
            "n": PKCE.base64URL(modulus),
            "e": PKCE.base64URL(exponent),
        ]
        nonisolated(unsafe) let secret = privateKey
        return TestSigningKey(algorithm: "RS256", keyID: keyID, publicJWK: jwk) { input in
            var signError: Unmanaged<CFError>?
            let signature = SecKeyCreateSignature(
                secret,
                .rsaSignatureMessagePKCS1v15SHA256,
                input as CFData,
                &signError
            )
            return (signature as Data?) ?? Data()
        }
    }

    // MARK: JWT / JWKS builders

    /// Compact JWS. `alg`, `kid` and the signature can be overridden to build attack tokens.
    func jwt(
        claims: [String: Any],
        alg: String? = nil,
        kid: String?? = nil,
        signatureOverride: Data? = nil
    ) -> String {
        var header: [String: Any] = ["alg": alg ?? algorithm, "typ": "JWT"]
        switch kid {
        case .none: header["kid"] = keyID
        case .some(.some(let value)): header["kid"] = value
        case .some(.none): break // explicitly no kid
        }
        let signingInput = "\(Self.segment(header)).\(Self.segment(claims))"
        let signature = signatureOverride ?? sign(Data(signingInput.utf8))
        return "\(signingInput).\(PKCE.base64URL(signature))"
    }

    static func segment(_ object: [String: Any]) -> String {
        let data = (try? JSONSerialization.data(withJSONObject: object, options: [.sortedKeys])) ?? Data()
        return PKCE.base64URL(data)
    }

    static func jwksJSON(_ keys: [TestSigningKey]) -> String {
        let object: [String: Any] = ["keys": keys.map(\.publicJWK)]
        let data = (try? JSONSerialization.data(withJSONObject: object, options: [.sortedKeys])) ?? Data()
        return String(decoding: data, as: UTF8.self)
    }
}

/// Reads `SEQUENCE { INTEGER n, INTEGER e }` (PKCS#1 RSAPublicKey) as exported by
/// `SecKeyCopyExternalRepresentation`; just enough DER for a test.
enum RSAPublicKeyDER {
    static func parse(_ der: Data) -> (modulus: Data, exponent: Data)? {
        let bytes = [UInt8](der)
        var index = 0

        func readLength() -> Int? {
            guard index < bytes.count else { return nil }
            let first = bytes[index]
            index += 1
            if first < 0x80 { return Int(first) }
            let count = Int(first & 0x7F)
            guard count > 0, count <= 4, index + count <= bytes.count else { return nil }
            var value = 0
            for _ in 0..<count {
                value = (value << 8) | Int(bytes[index])
                index += 1
            }
            return value
        }

        func readInteger() -> Data? {
            guard index < bytes.count, bytes[index] == 0x02 else { return nil }
            index += 1
            guard let length = readLength(), index + length <= bytes.count else { return nil }
            let value = Data(bytes[index..<index + length])
            index += length
            return value
        }

        guard index < bytes.count, bytes[index] == 0x30 else { return nil }
        index += 1
        guard readLength() != nil, let modulus = readInteger(), let exponent = readInteger() else { return nil }
        return (Data(modulus.drop { $0 == 0 }), exponent)
    }
}
