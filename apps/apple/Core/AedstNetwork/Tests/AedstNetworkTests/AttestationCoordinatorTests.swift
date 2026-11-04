import AedstCore
import AedstTesting
import CryptoKit
import Foundation
import Testing
@testable import AedstNetwork

/// Scriptable `AppAttestRemote`; an actor so its call log is race-free under Swift 6.
private actor FakeAppAttestRemote: AppAttestRemote {
    struct Enroll: Equatable {
        let keyID: String
        let attestationObject: Data
        let challenge: Data
        let bundleID: String
    }

    struct Verify: Equatable {
        let keyID: String
        let assertion: Data
        let action: String
        let payload: Data
    }

    private var challengeResults: [Outcome<Data>]
    private var enrollResults: [Outcome<AttestationVerdict>]
    private var verifyResults: [Outcome<AttestationVerdict>]
    private var issued = 0
    private(set) var createCount = 0
    private(set) var enrolls: [Enroll] = []
    private(set) var verifies: [Verify] = []

    init(
        challenges: [Outcome<Data>] = [],
        enrolls: [Outcome<AttestationVerdict>] = [],
        verifies: [Outcome<AttestationVerdict>] = []
    ) {
        self.challengeResults = challenges
        self.enrollResults = enrolls
        self.verifyResults = verifies
    }

    var callCount: Int { createCount + enrolls.count + verifies.count }

    func createChallenge() async -> Outcome<Data> {
        createCount += 1
        if !challengeResults.isEmpty { return challengeResults.removeFirst() }
        issued += 1
        return .success(Data(repeating: UInt8(issued), count: 32))  // fresh bytes per call
    }

    func enroll(keyID: String, attestationObject: Data, challenge: Data, bundleID: String) async -> Outcome<AttestationVerdict> {
        enrolls.append(Enroll(keyID: keyID, attestationObject: attestationObject, challenge: challenge, bundleID: bundleID))
        return enrollResults.isEmpty ? .success(.verified) : enrollResults.removeFirst()
    }

    func verifyAssertion(keyID: String, assertion: Data, action: String, payload: Data) async -> Outcome<AttestationVerdict> {
        verifies.append(Verify(keyID: keyID, assertion: assertion, action: action, payload: payload))
        return verifyResults.isEmpty ? .success(.verified) : verifyResults.removeFirst()
    }
}

private struct Harness {
    let backend: FakeAttestBackend
    let store: InMemorySecureStore
    let service: AppAttestService
    let remote: FakeAppAttestRemote
    let coordinator: AttestationCoordinator

    init(
        backend: FakeAttestBackend = FakeAttestBackend(),
        remote: FakeAppAttestRemote = FakeAppAttestRemote(),
        store: InMemorySecureStore = InMemorySecureStore()
    ) {
        self.backend = backend
        self.store = store
        self.remote = remote
        self.service = AppAttestService(backend: backend, store: store)
        self.coordinator = AttestationCoordinator(attestation: service, remote: remote, bundleID: "com.aedst.test")
    }
}

@Suite("AttestationCoordinator enrollment")
struct AttestationCoordinatorEnrollmentTests {
    @Test("happy path: challenge -> attestKey(SHA-256(challenge)) -> Enroll -> confirmed")
    func happyPath() async throws {
        let h = Harness()
        #expect(await h.coordinator.enrollIfNeeded() == .enrolled)

        #expect(await h.remote.createCount == 1)
        let enroll = try #require(await h.remote.enrolls.first)
        #expect(await h.remote.enrolls.count == 1)
        #expect(enroll.keyID == "key-1")
        #expect(enroll.bundleID == "com.aedst.test")
        #expect(enroll.challenge == Data(repeating: 1, count: 32))
        #expect(enroll.attestationObject == Data("attestation-key-1".utf8))
        #expect(await h.backend.lastClientDataHash == Data(SHA256.hash(data: enroll.challenge)))
        #expect(await h.service.needsEnrollment() == false)
    }

    @Test("a second call in the same sign-in does nothing")
    func oncePerSignIn() async {
        let h = Harness()
        _ = await h.coordinator.enrollIfNeeded()
        #expect(await h.coordinator.enrollIfNeeded() == .skipped)
        #expect(await h.remote.callCount == 2)  // one CreateChallenge + one Enroll
    }

    @Test("an enrolled install makes no network call")
    func alreadyEnrolled() async throws {
        let store = InMemorySecureStore(values: ["app_attest_key_id": "key-9", "app_attest_enrolled_key_id": "key-9"])
        let h = Harness(store: store)
        #expect(await h.coordinator.enrollIfNeeded() == .alreadyEnrolled)
        #expect(await h.remote.callCount == 0)
    }

    @Test("a rejected enrollment backs off: no retry loop, key kept unconfirmed")
    func rejectedDoesNotLoop() async throws {
        let remote = FakeAppAttestRemote(enrolls: [.success(.rejected(.certificateChainInvalid))])
        let h = Harness(remote: remote)

        #expect(await h.coordinator.enrollIfNeeded() == .rejected(.certificateChainInvalid))
        for _ in 0..<3 { #expect(await h.coordinator.enrollIfNeeded() == .skipped) }

        #expect(await remote.createCount == 1)
        #expect(await remote.enrolls.count == 1)
        #expect(await h.service.needsEnrollment())
    }

    @Test("a challenge is never reused: every attempt fetches a new one")
    func challengeNeverReused() async throws {
        let remote = FakeAppAttestRemote(enrolls: [.success(.rejected(.challengeInvalid))])
        let h = Harness(remote: remote)

        _ = await h.coordinator.enrollIfNeeded()
        await h.coordinator.reset()  // re-arms the single attempt (new sign-in)
        #expect(await h.coordinator.enrollIfNeeded() == .enrolled)

        let challenges = await remote.enrolls.map(\.challenge)
        #expect(challenges.count == 2)
        #expect(Set(challenges).count == 2)
        #expect(await remote.createCount == 2)
    }

    @Test("KEY_ALREADY_ENROLLED discards the key so the next attempt generates a new one")
    func keyAlreadyEnrolledDiscardsKey() async throws {
        let remote = FakeAppAttestRemote(enrolls: [.success(.rejected(.keyAlreadyEnrolled))])
        let h = Harness(remote: remote)
        #expect(await h.coordinator.enrollIfNeeded() == .rejected(.keyAlreadyEnrolled))
        #expect(try h.store.get("app_attest_key_id") == nil)
    }

    @Test("other rejections keep the key (configuration problems are not fixed by a new key)")
    func otherRejectionKeepsKey() async throws {
        let remote = FakeAppAttestRemote(enrolls: [.success(.rejected(.bundleNotAllowed))])
        let h = Harness(remote: remote)
        _ = await h.coordinator.enrollIfNeeded()
        #expect(try h.store.get("app_attest_key_id") == "key-1")
    }

    @Test("unsupported device: no key, no network, assertions unavailable")
    func unsupportedMakesNoNetworkCalls() async {
        let backend = FakeAttestBackend(isSupported: false)
        let h = Harness(backend: backend)
        #expect(await h.coordinator.enrollIfNeeded() == .unsupported)
        #expect(await h.coordinator.assert(action: "login", payload: Data()) == .unavailable)
        #expect(await h.remote.callCount == 0)
        #expect(await backend.generateCount == 0)
        #expect(h.coordinator.isSupported == false)
    }

    @Test("the no-op attester behaves like an unsupported device")
    func noopMakesNoNetworkCalls() async {
        let remote = FakeAppAttestRemote()
        let coordinator = AttestationCoordinator(attestation: NoopDeviceAttestation(), remote: remote, bundleID: "x")
        #expect(await coordinator.enrollIfNeeded() == .unsupported)
        #expect(await coordinator.assert(action: "login", payload: Data()) == .unavailable)
        #expect(await remote.callCount == 0)
    }

    @Test("sign-out resets: the key is discarded and the next user enrolls a fresh one")
    func signOutResetsKey() async throws {
        let h = Harness()
        _ = await h.coordinator.enrollIfNeeded()
        #expect(try h.store.get("app_attest_key_id") == "key-1")

        await h.coordinator.reset()
        #expect(try h.store.get("app_attest_key_id") == nil)
        #expect(try h.store.get("app_attest_enrolled_key_id") == nil)
        #expect(await h.service.needsEnrollment())

        #expect(await h.coordinator.enrollIfNeeded() == .enrolled)
        #expect(await h.remote.enrolls.map(\.keyID) == ["key-1", "key-2"])
    }
}

@Suite("AttestationCoordinator fail-open")
struct AttestationCoordinatorFailOpenTests {
    @Test("challenge transport failure: no key, no enroll call")
    func challengeFails() async {
        let remote = FakeAppAttestRemote(challenges: [.failure(.unavailable(reason: "offline"))])
        let h = Harness(remote: remote)
        #expect(await h.coordinator.enrollIfNeeded() == .failed)
        #expect(await remote.enrolls.isEmpty)
        #expect(await h.backend.generateCount == 0)
    }

    @Test("Apple unavailable: Enroll is never called and nothing is confirmed")
    func appleFails() async {
        let backend = FakeAttestBackend(attestFailures: [.serverUnavailable])
        let h = Harness(backend: backend)
        #expect(await h.coordinator.enrollIfNeeded() == .failed)
        #expect(await h.remote.enrolls.isEmpty)
        #expect(await h.service.needsEnrollment())
    }

    @Test("Enroll transport failure (server disabled, rate limited, offline) leaves the key unconfirmed")
    func enrollFails() async {
        for error in [AedstError.unavailable(reason: "x"), .invalidInput(fields: ["disabled"]), .rateLimited(retryAfter: nil), .unauthenticated] {
            let remote = FakeAppAttestRemote(enrolls: [.failure(error)])
            let h = Harness(remote: remote)
            #expect(await h.coordinator.enrollIfNeeded() == .failed)
            #expect(await h.service.needsEnrollment())
            #expect(await h.coordinator.enrollIfNeeded() == .skipped)
        }
    }

    @Test("a storage failure is absorbed, not thrown")
    func storageFails() async {
        let h = Harness(store: InMemorySecureStore(failWrites: true))
        #expect(await h.coordinator.enrollIfNeeded() == .failed)
        #expect(await h.remote.enrolls.isEmpty)
    }
}

@Suite("AttestationCoordinator assertions")
struct AttestationCoordinatorAssertionTests {
    private func enrolled(_ remote: FakeAppAttestRemote = FakeAppAttestRemote()) async -> Harness {
        let h = Harness(remote: remote)
        _ = await h.coordinator.enrollIfNeeded()
        return h
    }

    @Test("verified: the device signs SHA-256(clientData) and the server gets the same action and payload")
    func verified() async throws {
        let h = await enrolled()
        let payload = Data("hello".utf8)
        #expect(await h.coordinator.assert(action: "login", payload: payload) == .verified)

        let verify = try #require(await h.remote.verifies.first)
        #expect(verify.keyID == "key-1")
        #expect(verify.action == "login")
        #expect(verify.payload == payload)
        #expect(verify.assertion == Data("assertion-key-1".utf8))
        #expect(await h.backend.lastClientDataHash == AttestationClientData.hash(Data("aedst.appattest.v1\nlogin\nhello".utf8)))
    }

    @Test("rejected: the reason is passed through and the key is kept")
    func rejected() async throws {
        let remote = FakeAppAttestRemote(verifies: [.success(.rejected(.signatureInvalid)), .success(.rejected(.counterNotIncreasing))])
        let h = await enrolled(remote)
        #expect(await h.coordinator.assert(action: "login", payload: Data()) == .rejected(.signatureInvalid))
        #expect(await h.coordinator.assert(action: "login", payload: Data()) == .rejected(.counterNotIncreasing))
        #expect(try h.store.get("app_attest_key_id") == "key-1")
    }

    @Test("KEY_UNKNOWN discards the key and allows one new enrollment")
    func keyUnknown() async throws {
        let remote = FakeAppAttestRemote(verifies: [.success(.rejected(.keyUnknown))])
        let h = await enrolled(remote)
        #expect(await h.coordinator.assert(action: "login", payload: Data()) == .rejected(.keyUnknown))
        #expect(try h.store.get("app_attest_key_id") == nil)
        #expect(await h.coordinator.enrollIfNeeded() == .enrolled)
        #expect(await remote.enrolls.map(\.keyID) == ["key-1", "key-2"])
    }

    @Test("transport errors on VerifyAssertion are unavailable, never thrown")
    func transportError() async {
        let remote = FakeAppAttestRemote(verifies: [.failure(.unavailable(reason: "offline")), .failure(.rateLimited(retryAfter: nil))])
        let h = await enrolled(remote)
        #expect(await h.coordinator.assert(action: "login", payload: Data()) == .unavailable)
        #expect(await h.coordinator.assert(action: "login", payload: Data()) == .unavailable)
    }

    @Test("not enrolled: unavailable without a VerifyAssertion call")
    func notEnrolled() async {
        let h = Harness()
        #expect(await h.coordinator.assert(action: "login", payload: Data()) == .unavailable)
        #expect(await h.remote.verifies.isEmpty)
    }

    @Test("invalid action or oversized payload never reaches the device or the network")
    func invalidInput() async {
        let h = await enrolled()
        #expect(await h.coordinator.assert(action: "Login", payload: Data()) == .unavailable)
        #expect(await h.coordinator.assert(action: "", payload: Data()) == .unavailable)
        #expect(await h.coordinator.assert(action: "login", payload: Data(count: 4097)) == .unavailable)
        #expect(await h.remote.verifies.isEmpty)
        #expect(await h.coordinator.assert(action: "login", payload: Data(count: 4096)) == .verified)
    }

    @Test("an assertion error from the device (invalidKey) is unavailable and clears the key")
    func deviceAssertionFails() async throws {
        let backend = FakeAttestBackend(assertionFailures: [.keyInvalid])
        let h = Harness(backend: backend)
        _ = await h.coordinator.enrollIfNeeded()
        #expect(await h.coordinator.assert(action: "login", payload: Data()) == .unavailable)
        #expect(await h.remote.verifies.isEmpty)
        #expect(try h.store.get("app_attest_key_id") == nil)
    }
}

@Suite("ConnectAppAttestRemote reason mapping")
struct ConnectAppAttestRemoteMappingTests {
    @Test("every generated FailureReason maps to its client category")
    func mapsReasons() {
        let cases: [(Aedst_Appattest_V1_FailureReason, AttestationFailureReason)] = [
            (.challengeInvalid, .challengeInvalid),
            (.bundleNotAllowed, .bundleNotAllowed),
            (.attestationMalformed, .attestationMalformed),
            (.certificateChainInvalid, .certificateChainInvalid),
            (.nonceMismatch, .nonceMismatch),
            (.keyIDMismatch, .keyIDMismatch),
            (.appIDMismatch, .appIDMismatch),
            (.counterNotZero, .counterNotZero),
            (.aaguidInvalid, .aaguidInvalid),
            (.environmentNotAllowed, .environmentNotAllowed),
            (.keyAlreadyEnrolled, .keyAlreadyEnrolled),
            (.keyUnknown, .keyUnknown),
            (.assertionMalformed, .assertionMalformed),
            (.signatureInvalid, .signatureInvalid),
            (.counterNotIncreasing, .counterNotIncreasing),
            (.unspecified, .unknown),
            (.UNRECOGNIZED(99), .unknown),
        ]
        for (proto, expected) in cases {
            #expect(ConnectAppAttestRemote.reason(proto) == expected, "\(proto)")
        }
    }

    @Test("verified wins over any reason; unverified carries the reason")
    func verdicts() {
        #expect(ConnectAppAttestRemote.verdict(verified: true, reason: .unspecified) == .verified)
        #expect(ConnectAppAttestRemote.verdict(verified: false, reason: .nonceMismatch) == .rejected(.nonceMismatch))
    }
}
