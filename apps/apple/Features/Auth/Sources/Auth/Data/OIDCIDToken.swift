import AedstCore
import CryptoKit
import Foundation

/// Verifies an ID token end to end (OIDC Core section 3.1.3.7): the JWS signature against the
/// provider's published keys first, then the claims (`IDTokenValidator`).
///
/// The signature is verified even though the token arrives over TLS from the token endpoint:
/// OIDC Core permits skipping it in that case, but verifying costs one cached request and
/// removes the dependence on the transport alone (a TLS-intercepting proxy, a misconfigured
/// IdP, a mixed-up endpoint). Algorithms are an allow-list (`JWSAlgorithm`); the key is
/// chosen by `kid` AND must match the algorithm family, so `alg: none`, `HS256` signed with
/// the public key, and RS256-vs-ES256 confusion are all rejected.
///
/// Error contract: `.unauthenticated` = the token is not valid; `.decoding` = malformed input or
/// a provider document we cannot use; `.unavailable`/`.rateLimited` = could not fetch the keys.
struct IDTokenVerifier: Sendable {
    let keySet: OIDCKeySet

    func subject(
        ofIDToken jwt: String,
        issuer: String,
        clientID: String,
        expectedNonce: String,
        accessToken: String? = nil,
        now: Date
    ) async -> Outcome<String> {
        let segments = jwt.split(separator: ".", omittingEmptySubsequences: false).map(String.init)
        guard segments.count == 3,
              let headerData = AccessTokenClaims.decodeBase64URL(segments[0]),
              let headerObject = try? JSONSerialization.jsonObject(with: headerData),
              let header = headerObject as? [String: Any]
        else {
            return .failure(.decoding(reason: "id_token is not a readable JWS"))
        }
        // `crit` lists extensions we do not understand and must therefore reject (RFC 7515 4.1.11).
        // The algorithm is checked before anything else: `none` and `HS*` die here.
        guard header["crit"] == nil,
              let algName = header["alg"] as? String,
              let algorithm = JWSAlgorithm(rawValue: algName)
        else {
            return .failure(.unauthenticated)
        }
        guard let signature = AccessTokenClaims.decodeBase64URL(segments[2]), !signature.isEmpty else {
            return .failure(.unauthenticated)
        }

        let key: JSONWebKey
        switch await keySet.key(keyID: header["kid"] as? String, algorithm: algorithm) {
        case .success(let value): key = value
        case .failure(let error): return .failure(error)
        }

        let signingInput = Data("\(segments[0]).\(segments[1])".utf8)
        guard JWSVerifier.isValid(signature: signature, signingInput: signingInput, algorithm: algorithm, key: key) else {
            return .failure(.unauthenticated)
        }

        return IDTokenValidator.subject(
            ofIDToken: jwt,
            issuer: issuer,
            clientID: clientID,
            expectedNonce: expectedNonce,
            accessToken: accessToken,
            algorithm: algorithm,
            now: now
        )
    }
}

/// Checks the claims of an ID token (OIDC Core section 3.1.3.7) and returns its `sub`.
///
/// This stage does NOT check the signature; production code reaches it only through
/// `IDTokenVerifier`, which does. Checked: `iss` equals the configured issuer, `aud` contains
/// our client id, `azp` (when present) is our client id, `exp` is in the future and `iat` not
/// in the future (60 s skew each way), `nonce` equals the one sent in this authorization
/// request (constant-time), and `at_hash` (when present and an access token is given) matches
/// the access token. Authorization decisions never rest on this token; the server verifies
/// every access token's signature itself.
enum IDTokenValidator {
    static let clockSkewLeeway: TimeInterval = 60

    static func subject(
        ofIDToken jwt: String,
        issuer: String,
        clientID: String,
        expectedNonce: String,
        accessToken: String? = nil,
        algorithm: JWSAlgorithm = .rs256,
        now: Date
    ) -> Outcome<String> {
        let segments = jwt.split(separator: ".", omittingEmptySubsequences: false)
        guard segments.count == 3,
              let payload = AccessTokenClaims.decodeBase64URL(String(segments[1])),
              let object = try? JSONSerialization.jsonObject(with: payload),
              let claims = object as? [String: Any]
        else {
            return .failure(.decoding(reason: "id_token is not a readable JWT"))
        }

        guard claims["iss"] as? String == issuer else { return .failure(.unauthenticated) }

        let audiences: [String]
        switch claims["aud"] {
        case let single as String: audiences = [single]
        case let many as [Any]: audiences = many.compactMap { $0 as? String }
        default: audiences = []
        }
        guard audiences.contains(clientID) else { return .failure(.unauthenticated) }

        // OIDC Core: with several audiences `azp` SHOULD be present; when it is, it must be us.
        // Absence is tolerated because some providers (ZITADEL adds project ids to `aud`) omit it.
        if let rawAuthorizedParty = claims["azp"] {
            guard let authorizedParty = rawAuthorizedParty as? String, authorizedParty == clientID else {
                return .failure(.unauthenticated)
            }
        }

        guard let exp = (claims["exp"] as? NSNumber)?.doubleValue,
              Date(timeIntervalSince1970: exp).addingTimeInterval(clockSkewLeeway) > now
        else { return .failure(.unauthenticated) }

        if let issuedAt = (claims["iat"] as? NSNumber)?.doubleValue,
           Date(timeIntervalSince1970: issuedAt).addingTimeInterval(-clockSkewLeeway) > now {
            return .failure(.unauthenticated)
        }

        // Required whenever an id_token is returned: we always send a nonce.
        guard let nonce = claims["nonce"] as? String, ConstantTime.equals(nonce, expectedNonce) else {
            return .failure(.unauthenticated)
        }

        if let accessToken, let rawHash = claims["at_hash"] {
            guard let atHash = rawHash as? String,
                  ConstantTime.equals(atHash, Self.accessTokenHash(accessToken, algorithm: algorithm))
            else { return .failure(.unauthenticated) }
        }

        guard let subject = claims["sub"] as? String, !subject.isEmpty else {
            return .failure(.decoding(reason: "id_token carried no sub"))
        }
        return .success(subject)
    }

    /// `at_hash` (OIDC Core section 3.1.3.6): base64url of the left half of the access token's
    /// hash, using the hash of the ID token's signing algorithm (SHA-256 for RS256/ES256,
    /// SHA-512 for Ed25519 per the EdDSA registration).
    static func accessTokenHash(_ accessToken: String, algorithm: JWSAlgorithm) -> String {
        let input = Data(accessToken.utf8)
        let digest: [UInt8]
        switch algorithm {
        case .rs256, .es256: digest = Array(SHA256.hash(data: input))
        case .edDSA: digest = Array(SHA512.hash(data: input))
        }
        return PKCE.base64URL(Data(digest.prefix(digest.count / 2)))
    }
}
