import AedstCore
import AedstTesting
import CryptoKit
import Foundation
import Testing
@testable import Auth

/// Mutable JWKS the stub provider serves; lets a test rotate keys between requests.
private final class JWKSBox: @unchecked Sendable {
    private let lock = NSLock()
    private var keys: [TestSigningKey]
    init(_ keys: [TestSigningKey]) { self.keys = keys }
    func set(_ keys: [TestSigningKey]) { lock.withLock { self.keys = keys } }
    var body: String { lock.withLock { OIDCFixtures.jwksJSON(keys) } }
}

@Suite("IDTokenVerifier (signature)")
struct IDTokenVerifierTests {
    private let nonce = "n-1"
    private let now = OIDCFixtures.now

    private struct Harness {
        let verifier: IDTokenVerifier
        let stub: StubTransport
        let clock: ManualClock
        let box: JWKSBox

        var jwksRequests: Int { stub.requests(toPath: "/oauth/v2/keys").count }
    }

    private func harness(keys: [TestSigningKey], discovery: String? = nil) -> Harness {
        let box = JWKSBox(keys)
        let stub = OIDCFixtures.transport(
            discovery: .init(status: 200, body: discovery ?? OIDCFixtures.discoveryJSON()),
            jwks: { .init(status: 200, body: box.body) }
        )
        let clock = ManualClock(now: now)
        let discovery = OIDCDiscovery(configuration: OIDCFixtures.configuration, transport: stub.transport)
        let keySet = OIDCKeySet(discovery: discovery, transport: stub.transport, clock: clock)
        return Harness(verifier: IDTokenVerifier(keySet: keySet), stub: stub, clock: clock, box: box)
    }

    private func verify(_ token: String, with harness: Harness, accessToken: String? = nil) async -> Outcome<String> {
        await harness.verifier.subject(
            ofIDToken: token,
            issuer: OIDCFixtures.issuer,
            clientID: OIDCFixtures.clientID,
            expectedNonce: nonce,
            accessToken: accessToken,
            now: harness.clock.now
        )
    }

    // MARK: Positive

    @Test("a valid token signed with each allowed algorithm yields its subject")
    func validAlgorithms() async {
        let keys = [
            TestSigningKey.p256(keyID: "ec"),
            TestSigningKey.ed25519(keyID: "ed"),
            TestSigningKey.rsa(keyID: "rsa"),
        ]
        let harness = harness(keys: keys)
        for key in keys {
            let token = OIDCFixtures.idToken(nonce: nonce, key: key)
            #expect(await verify(token, with: harness).value == "user-1", "alg \(key.algorithm)")
        }
    }

    @Test("a matching at_hash is accepted, a wrong one is rejected")
    func atHash() async {
        let key = OIDCFixtures.signingKey
        let harness = harness(keys: [key])
        let good = IDTokenValidator.accessTokenHash("access-1", algorithm: .es256)

        let accepted = OIDCFixtures.idToken(nonce: nonce, extra: ["at_hash": good])
        let rejected = OIDCFixtures.idToken(nonce: nonce, extra: ["at_hash": "AAAAAAAAAAAAAAAAAAAAAA"])

        #expect(await verify(accepted, with: harness, accessToken: "access-1").value == "user-1")
        #expect(await verify(rejected, with: harness, accessToken: "access-1").error == .unauthenticated)
        // No access token to compare against: the claim is not checked.
        #expect(await verify(rejected, with: harness, accessToken: nil).value == "user-1")
    }

    @Test("at_hash reference vector: left half of SHA-256, base64url")
    func atHashVector() {
        // OIDC Core section A.3 example: access token and its at_hash.
        let accessToken = "jHkWEdUXMU1BwAsC4vtUsZwnNvTIxEl0z9K3vx5KF0Y"
        #expect(IDTokenValidator.accessTokenHash(accessToken, algorithm: .rs256) == "77QmUPtjPfzWtF2AnpK9RQ")
    }

    // MARK: Table-driven negatives

    struct Case: Sendable, CustomTestStringConvertible {
        let name: String
        let build: @Sendable (_ trusted: TestSigningKey, _ attacker: TestSigningKey) -> String
        let expected: AedstError
        var testDescription: String { name }
    }

    static let validNonce = "n-1"

    static let negatives: [Case] = [
        Case(name: "signature from a different key with the right kid", build: { _, attacker in
            attacker.jwt(claims: OIDCFixtures.idTokenClaims(nonce: IDTokenVerifierTests.validNonce), kid: .some(.some("key-1")))
        }, expected: .unauthenticated),
        Case(name: "payload altered after signing", build: { trusted, _ in
            let original = trusted.jwt(claims: OIDCFixtures.idTokenClaims(nonce: IDTokenVerifierTests.validNonce))
            let parts = original.split(separator: ".", omittingEmptySubsequences: false).map(String.init)
            let forged = TestSigningKey.segment(OIDCFixtures.idTokenClaims(nonce: IDTokenVerifierTests.validNonce, subject: "admin"))
            return "\(parts[0]).\(forged).\(parts[2])"
        }, expected: .unauthenticated),
        Case(name: "unknown kid", build: { trusted, _ in
            trusted.jwt(claims: OIDCFixtures.idTokenClaims(nonce: IDTokenVerifierTests.validNonce), kid: .some(.some("other")))
        }, expected: .unauthenticated),
        Case(name: "alg none with an empty signature", build: { trusted, _ in
            trusted.jwt(claims: OIDCFixtures.idTokenClaims(nonce: IDTokenVerifierTests.validNonce), alg: "none", signatureOverride: Data())
        }, expected: .unauthenticated),
        Case(name: "alg none keeping a real signature", build: { trusted, _ in
            trusted.jwt(claims: OIDCFixtures.idTokenClaims(nonce: IDTokenVerifierTests.validNonce), alg: "none")
        }, expected: .unauthenticated),
        Case(name: "HS256 (public key used as HMAC secret)", build: { trusted, _ in
            // The attacker MACs with the published JWK bytes: the classic alg-confusion token.
            let secret = SymmetricKey(data: Data(OIDCFixtures.jwksJSON([trusted]).utf8))
            let header = TestSigningKey.segment(["alg": "HS256", "typ": "JWT", "kid": trusted.keyID])
            let payload = TestSigningKey.segment(OIDCFixtures.idTokenClaims(nonce: IDTokenVerifierTests.validNonce))
            let mac = HMAC<SHA256>.authenticationCode(for: Data("\(header).\(payload)".utf8), using: secret)
            return "\(header).\(payload).\(PKCE.base64URL(Data(mac)))"
        }, expected: .unauthenticated),
        Case(name: "algorithm outside the allow-list (PS256)", build: { trusted, _ in
            trusted.jwt(claims: OIDCFixtures.idTokenClaims(nonce: IDTokenVerifierTests.validNonce), alg: "PS256")
        }, expected: .unauthenticated),
        Case(name: "header alg RS256 but the kid names an EC key", build: { trusted, _ in
            trusted.jwt(claims: OIDCFixtures.idTokenClaims(nonce: IDTokenVerifierTests.validNonce), alg: "RS256")
        }, expected: .unauthenticated),
        Case(name: "unsupported critical header", build: { trusted, _ in
            let header = TestSigningKey.segment(["alg": trusted.algorithm, "kid": trusted.keyID, "crit": ["exp"]])
            let payload = TestSigningKey.segment(OIDCFixtures.idTokenClaims(nonce: IDTokenVerifierTests.validNonce))
            let signature = trusted.sign(Data("\(header).\(payload)".utf8))
            return "\(header).\(payload).\(PKCE.base64URL(signature))"
        }, expected: .unauthenticated),
        Case(name: "expired", build: { trusted, _ in
            OIDCFixtures.idToken(
                nonce: IDTokenVerifierTests.validNonce,
                expiresAt: OIDCFixtures.now.addingTimeInterval(-3_600),
                key: trusted
            )
        }, expected: .unauthenticated),
        Case(name: "wrong audience", build: { trusted, _ in
            OIDCFixtures.idToken(nonce: IDTokenVerifierTests.validNonce, audience: "other-client", key: trusted)
        }, expected: .unauthenticated),
        Case(name: "wrong issuer", build: { trusted, _ in
            OIDCFixtures.idToken(nonce: IDTokenVerifierTests.validNonce, issuer: "https://evil.example.com", key: trusted)
        }, expected: .unauthenticated),
        Case(name: "wrong nonce", build: { trusted, _ in
            OIDCFixtures.idToken(nonce: "replayed", key: trusted)
        }, expected: .unauthenticated),
        Case(name: "missing nonce", build: { trusted, _ in
            OIDCFixtures.idToken(nonce: nil, key: trusted)
        }, expected: .unauthenticated),
        Case(name: "azp names another client", build: { trusted, _ in
            OIDCFixtures.idToken(nonce: IDTokenVerifierTests.validNonce, extra: ["azp": "other-client"], key: trusted)
        }, expected: .unauthenticated),
        Case(name: "iat far in the future", build: { trusted, _ in
            OIDCFixtures.idToken(
                nonce: IDTokenVerifierTests.validNonce,
                extra: ["iat": OIDCFixtures.now.addingTimeInterval(3_600).timeIntervalSince1970],
                key: trusted
            )
        }, expected: .unauthenticated),
        Case(name: "not a JWS at all", build: { _, _ in "garbage" }, expected: .decoding(reason: "id_token is not a readable JWS")),
    ]

    @Test("every forged or invalid token is rejected", arguments: IDTokenVerifierTests.negatives)
    func negative(_ testCase: Case) async {
        let trusted = OIDCFixtures.signingKey
        let harness = harness(keys: [trusted])
        let token = testCase.build(trusted, TestSigningKey.p256(keyID: "attacker"))

        let result = await verify(token, with: harness)

        #expect(result.value == nil)
        #expect(result.error == testCase.expected)
    }

    // MARK: Key set behaviour

    @Test("an unknown kid triggers one refetch (key rotation) once the throttle has passed")
    func rotation() async {
        let old = TestSigningKey.p256(keyID: "old")
        let rotated = TestSigningKey.p256(keyID: "new")
        let harness = harness(keys: [old])
        #expect(await verify(OIDCFixtures.idToken(nonce: nonce, key: old), with: harness).value == "user-1")
        #expect(harness.jwksRequests == 1)

        harness.box.set([old, rotated])
        let token = OIDCFixtures.idToken(nonce: nonce, key: rotated)

        // Too soon after the last fetch: no new request, token rejected.
        harness.clock.advance(by: 5)
        #expect(await verify(token, with: harness).error == .unauthenticated)
        #expect(harness.jwksRequests == 1)

        // Throttle over: exactly one refetch, token accepted.
        harness.clock.advance(by: 60)
        #expect(await verify(token, with: harness).value == "user-1")
        #expect(harness.jwksRequests == 2)
    }

    @Test("keys are cached until the TTL, then refetched")
    func timeToLive() async {
        let key = OIDCFixtures.signingKey
        let harness = harness(keys: [key])
        let token = OIDCFixtures.idToken(nonce: nonce, expiresAt: now.addingTimeInterval(86_400 * 2))

        _ = await verify(token, with: harness)
        _ = await verify(token, with: harness)
        #expect(harness.jwksRequests == 1)

        harness.clock.advance(by: OIDCKeySet.defaultTimeToLive + 1)
        _ = await verify(token, with: harness)
        #expect(harness.jwksRequests == 2)
    }

    @Test("concurrent lookups share one JWKS request")
    func singleFlight() async {
        let key = OIDCFixtures.signingKey
        let harness = harness(keys: [key])
        let token = OIDCFixtures.idToken(nonce: nonce)

        await withTaskGroup(of: Bool.self) { group in
            for _ in 0..<8 {
                group.addTask { await verify(token, with: harness).value == "user-1" }
            }
            for await ok in group { #expect(ok) }
        }

        #expect(harness.jwksRequests == 1)
    }

    @Test("a discovery document without jwks_uri fails closed")
    func missingJWKSURI() async {
        let harness = harness(keys: [OIDCFixtures.signingKey], discovery: OIDCFixtures.discoveryJSON(jwks: false))

        let result = await verify(OIDCFixtures.idToken(nonce: nonce), with: harness)

        #expect(result.error == .decoding(reason: "discovery document has no jwks_uri"))
    }

    @Test("a JWKS outage is a transient error, not a forged token")
    func jwksOutage() async {
        let stub = OIDCFixtures.transport(jwks: { .init(status: 503, body: "") })
        let discovery = OIDCDiscovery(configuration: OIDCFixtures.configuration, transport: stub.transport)
        let keySet = OIDCKeySet(discovery: discovery, transport: stub.transport, clock: ManualClock(now: now))
        let verifier = IDTokenVerifier(keySet: keySet)

        let result = await verifier.subject(
            ofIDToken: OIDCFixtures.idToken(nonce: nonce),
            issuer: OIDCFixtures.issuer,
            clientID: OIDCFixtures.clientID,
            expectedNonce: nonce,
            now: now
        )

        #expect(result.error == .unavailable(reason: "http 503"))
    }

    @Test("keys of unsupported type, curve or size are ignored")
    func unsupportedKeys() {
        #expect(JSONWebKey(json: ["kty": "oct", "k": "AAAA"]) == nil)
        #expect(JSONWebKey(json: ["kty": "EC", "crv": "P-384", "x": "AA", "y": "AA"]) == nil)
        #expect(JSONWebKey(json: ["kty": "RSA", "n": "AQAB", "e": "AQAB"]) == nil) // 8-bit modulus
        #expect(JSONWebKey(json: ["kty": "EC", "use": "enc"]) == nil)
    }
}

@Suite("ConstantTime")
struct ConstantTimeTests {
    @Test("equal strings compare equal, anything else does not")
    func comparison() {
        #expect(ConstantTime.equals("abc", "abc"))
        #expect(ConstantTime.equals("", ""))
        #expect(!ConstantTime.equals("abc", "abd"))
        #expect(!ConstantTime.equals("abc", "abcd"))
        #expect(!ConstantTime.equals("abcd", "abc"))
        #expect(!ConstantTime.equals("", "a"))
    }
}
