import AedstCore
import AedstTesting
import CryptoKit
import Foundation
import Testing
@testable import AedstNetwork

/// Scriptable backend; an actor so its counters are race-free under Swift 6.
actor FakeAttestBackend: AttestServiceBackend {
    nonisolated let isSupported: Bool
    private var generated = 0
    private var attestFailures: [DeviceAttestationError]
    private var assertionFailures: [DeviceAttestationError]
    private(set) var attestedKeys: [String] = []
    private(set) var lastClientDataHash: Data?

    init(
        isSupported: Bool = true,
        attestFailures: [DeviceAttestationError] = [],
        assertionFailures: [DeviceAttestationError] = []
    ) {
        self.isSupported = isSupported
        self.attestFailures = attestFailures
        self.assertionFailures = assertionFailures
    }

    var generateCount: Int { generated }

    func generateKey() async throws -> String {
        generated += 1
        return "key-\(generated)"
    }

    func attestKey(_ keyID: String, clientDataHash: Data) async throws -> Data {
        lastClientDataHash = clientDataHash
        if !attestFailures.isEmpty { throw attestFailures.removeFirst() }
        attestedKeys.append(keyID)
        return Data("attestation-\(keyID)".utf8)
    }

    func generateAssertion(_ keyID: String, clientDataHash: Data) async throws -> Data {
        lastClientDataHash = clientDataHash
        if !assertionFailures.isEmpty { throw assertionFailures.removeFirst() }
        return Data("assertion-\(keyID)".utf8)
    }
}

@Suite("AttestationClientData")
struct AttestationClientDataTests {
    @Test("clientData is tag LF action LF payload, byte for byte")
    func exactBytes() {
        let data = AttestationClientData.make(action: "login", payload: Data("hello".utf8))
        #expect(data == Data("aedst.appattest.v1\nlogin\nhello".utf8))
        #expect(Array(data.prefix(19)) == Array("aedst.appattest.v1".utf8) + [0x0A])
    }

    @Test("empty payload keeps both separators; binary payload is appended raw")
    func payloadHandling() {
        #expect(AttestationClientData.make(action: "login", payload: Data()) == Data("aedst.appattest.v1\nlogin\n".utf8))
        let binary = AttestationClientData.make(action: "a", payload: Data([0x01, 0x0A, 0xFF]))
        #expect(binary == Data("aedst.appattest.v1\na\n".utf8) + Data([0x01, 0x0A, 0xFF]))
    }

    @Test("hash is SHA-256 of the whole clientData (known vectors)")
    func hashVectors() {
        let hex = { (data: Data) in data.map { String(format: "%02x", $0) }.joined() }
        #expect(hex(AttestationClientData.hash(AttestationClientData.make(action: "login", payload: Data("hello".utf8))))
            == "fa8bd31b352a606bf6d7d484f59696ba65b58cb90c827fb3b0e7acdf5a96c867")
        #expect(hex(AttestationClientData.hash(AttestationClientData.make(action: "login", payload: Data())))
            == "eb3728c9c862db552d8dbb34eb9728e7cd2cdc466012afae3d18af6b459d183c")
        #expect(hex(AttestationClientData.hash(Data("abc".utf8)))
            == "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad")
    }

    @Test("action and payload each change the output (no field-boundary collisions)")
    func sensitive() {
        let a = AttestationClientData.make(action: "ab", payload: Data("c".utf8))
        let b = AttestationClientData.make(action: "a", payload: Data("bc".utf8))
        #expect(a != b)
    }

    @Test("action validation mirrors the proto pattern ^[a-z][a-z0-9._-]*$ and 1...64")
    func actionValidation() {
        for valid in ["login", "a", "purchase.confirm", "x-1_2.y", String(repeating: "a", count: 64)] {
            #expect(AttestationClientData.isValid(action: valid), "\(valid)")
        }
        for invalid in ["", "Login", "1abc", "-a", "a b", "a\nb", "ä", String(repeating: "a", count: 65)] {
            #expect(!AttestationClientData.isValid(action: invalid), "\(invalid)")
        }
    }
}

@Suite("DeviceAttestation")
struct DeviceAttestationTests {
    private let challenge = Data(repeating: 1, count: 32)

    @Test("noop is unsupported and produces nothing")
    func noop() async throws {
        let noop = NoopDeviceAttestation()
        #expect(noop.isSupported == false)
        #expect(await noop.needsEnrollment() == false)
        #expect(try await noop.attestKeyIfNeeded(challenge: challenge) == nil)
        #expect(try await noop.assertion(for: Data()) == nil)
        try await noop.reset()
    }

    @Test("unsupported backend never generates a key")
    func unsupportedBackend() async throws {
        let backend = FakeAttestBackend(isSupported: false)
        let service = AppAttestService(backend: backend, store: InMemorySecureStore())
        #expect(try await service.attestKeyIfNeeded(challenge: challenge) == nil)
        #expect(await backend.generateCount == 0)
    }

    @Test("enrollment persists the key id and binds the attestation to SHA-256(challenge)")
    func enrollmentPersists() async throws {
        let backend = FakeAttestBackend()
        let store = InMemorySecureStore()
        let service = AppAttestService(backend: backend, store: store)

        let enrollment = try #require(try await service.attestKeyIfNeeded(challenge: challenge))
        #expect(enrollment.keyID == "key-1")
        #expect(enrollment.challenge == challenge)
        #expect(try store.get("app_attest_key_id") == "key-1")
        #expect(await backend.lastClientDataHash == Data(SHA256.hash(data: challenge)))
    }

    @Test("key id is reused on a second attempt before confirmation")
    func keyReuse() async throws {
        let backend = FakeAttestBackend()
        let service = AppAttestService(backend: backend, store: InMemorySecureStore())
        _ = try await service.attestKeyIfNeeded(challenge: challenge)
        let second = try #require(try await service.attestKeyIfNeeded(challenge: challenge))
        #expect(second.keyID == "key-1")
        #expect(await backend.generateCount == 1)
    }

    @Test("after confirmation no further enrollment is requested and assertions are over SHA-256(clientData)")
    func confirmedFlow() async throws {
        let backend = FakeAttestBackend()
        let service = AppAttestService(backend: backend, store: InMemorySecureStore())
        #expect(try await service.assertion(for: Data("x".utf8)) == nil)  // not enrolled yet
        _ = try await service.attestKeyIfNeeded(challenge: challenge)
        try await service.confirmEnrollment()

        #expect(await service.needsEnrollment() == false)
        #expect(try await service.attestKeyIfNeeded(challenge: challenge) == nil)
        let clientData = AttestationClientData.make(action: "login", payload: Data("hello".utf8))
        let assertion = try #require(try await service.assertion(for: clientData))
        #expect(assertion.keyID == "key-1")
        #expect(await backend.lastClientDataHash == Data(SHA256.hash(data: clientData)))
    }

    @Test("reset discards the key and the enrollment mark; the next enrollment uses a fresh key")
    func resetDiscardsKey() async throws {
        let backend = FakeAttestBackend()
        let store = InMemorySecureStore()
        let service = AppAttestService(backend: backend, store: store)
        _ = try await service.attestKeyIfNeeded(challenge: challenge)
        try await service.confirmEnrollment()
        #expect(await service.needsEnrollment() == false)

        try await service.reset()
        #expect(try store.get("app_attest_key_id") == nil)
        #expect(try store.get("app_attest_enrolled_key_id") == nil)
        #expect(await service.needsEnrollment())
        #expect(try await service.assertion(for: Data("x".utf8)) == nil)

        let next = try #require(try await service.attestKeyIfNeeded(challenge: challenge))
        #expect(next.keyID == "key-2")
        #expect(await backend.generateCount == 2)
    }

    @Test("reset on a store that never held a key is harmless")
    func resetWhenEmpty() async throws {
        let service = AppAttestService(backend: FakeAttestBackend(), store: InMemorySecureStore())
        try await service.reset()
        #expect(await service.needsEnrollment())
    }

    @Test("invalidKey during attestation discards the key and enrolls with a fresh one")
    func reEnrollAfterInvalidKey() async throws {
        let backend = FakeAttestBackend(attestFailures: [.keyInvalid])
        let store = InMemorySecureStore(values: ["app_attest_key_id": "stale"])
        let service = AppAttestService(backend: backend, store: store)

        let enrollment = try #require(try await service.attestKeyIfNeeded(challenge: challenge))
        #expect(enrollment.keyID == "key-1")
        #expect(try store.get("app_attest_key_id") == "key-1")
    }

    @Test("invalidKey during an assertion clears enrollment and is surfaced")
    func assertionInvalidKey() async throws {
        let backend = FakeAttestBackend(assertionFailures: [.keyInvalid])
        let store = InMemorySecureStore()
        let service = AppAttestService(backend: backend, store: store)
        _ = try await service.attestKeyIfNeeded(challenge: challenge)
        try await service.confirmEnrollment()

        await #expect(throws: DeviceAttestationError.keyInvalid) {
            _ = try await service.assertion(for: Data("x".utf8))
        }
        #expect(try store.get("app_attest_key_id") == nil)
        #expect(await service.needsEnrollment())
    }

    @Test("other backend errors propagate without wiping the key")
    func serverUnavailable() async throws {
        let backend = FakeAttestBackend(attestFailures: [.serverUnavailable])
        let store = InMemorySecureStore()
        let service = AppAttestService(backend: backend, store: store)
        await #expect(throws: DeviceAttestationError.serverUnavailable) {
            _ = try await service.attestKeyIfNeeded(challenge: challenge)
        }
        #expect(try store.get("app_attest_key_id") == "key-1")
    }

    @Test("a storage failure is reported as storage, not swallowed")
    func storageFailure() async {
        let store = InMemorySecureStore(failWrites: true)
        let service = AppAttestService(backend: FakeAttestBackend(), store: store)
        await #expect(throws: DeviceAttestationError.self) {
            _ = try await service.attestKeyIfNeeded(challenge: challenge)
        }
    }
}
