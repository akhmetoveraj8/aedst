import AedstCore
import CryptoKit
import Foundation

#if canImport(DeviceCheck)
    import DeviceCheck
#endif

// Client side of Apple App Attest (ADR-0016). The app only PRODUCES evidence; every verification
// (certificate chain, nonce, counter, policy) happens on the backend (`AppAttestService` RPCs, driven by
// `AttestationCoordinator`).
//
// Policy for callers: attestation must never block app use. If the device is unsupported, the user is
// offline, Apple's servers are unavailable or anything throws, carry on without it and let the server decide
// (fail-open at first, ADR-0016). Do not show an error to the user.

/// Errors from the attestation flow. Local to this file on purpose: they are never user-facing and are not
/// part of `AedstError`'s UI mapping.
public enum DeviceAttestationError: Error, Equatable, Sendable {
    /// App Attest is unavailable (simulator, some Macs, Mac Catalyst, restricted device).
    case unsupported
    /// The key is unknown to the system (`DCError.invalidKey`, e.g. restored backup or reinstall). The stored
    /// key id has been discarded; enroll again.
    case keyInvalid
    /// Apple's attestation service is unreachable or throttling (`DCError.serverUnavailable`). Retry later.
    case serverUnavailable
    /// Persisting or reading the key id failed.
    case storage(reason: String)
    case other(reason: String)
}

/// Result of a successful key attestation, to be sent to the enrollment RPC together with the challenge.
public struct AttestationEnrollment: Equatable, Sendable {
    public let keyID: String
    public let attestationObject: Data
    /// The server challenge the attestation was bound to (the server verifies it against what it issued).
    public let challenge: Data
}

/// One assertion; send it to `VerifyAssertion` together with the same action and payload it was made for.
public struct DeviceAssertion: Equatable, Sendable {
    public let keyID: String
    public let assertion: Data
}

public protocol DeviceAttesting: Sendable {
    var isSupported: Bool { get }

    /// True when there is no enrollment the server has confirmed yet (check before spending a challenge RPC).
    func needsEnrollment() async -> Bool

    /// Generates the key once, then attests it with `challenge` (a single-use 32-byte server challenge).
    /// Returns `nil` when unsupported or already enrolled. Call `confirmEnrollment()` after the server accepted it.
    func attestKeyIfNeeded(challenge: Data) async throws -> AttestationEnrollment?

    /// Marks the current key as accepted by the server. Until then assertions are not produced.
    func confirmEnrollment() async throws

    /// Signs `clientData` (see `AttestationClientData.make`) with the enrolled key: the key is asked for an
    /// assertion over `SHA-256(clientData)`. `nil` when unsupported or not enrolled.
    func assertion(for clientData: Data) async throws -> DeviceAssertion?

    /// Discards the stored key and its enrollment mark; the next `attestKeyIfNeeded` generates a fresh key.
    /// Called on sign-out and when the server no longer knows the key.
    func reset() async throws
}

/// Always-unsupported attester for simulators, unsupported platforms and tests.
public struct NoopDeviceAttestation: DeviceAttesting {
    public init() {}
    public var isSupported: Bool { false }
    public func needsEnrollment() async -> Bool { false }
    public func attestKeyIfNeeded(challenge _: Data) async throws -> AttestationEnrollment? { nil }
    public func confirmEnrollment() async throws {}
    public func assertion(for _: Data) async throws -> DeviceAssertion? { nil }
    public func reset() async throws {}
}

/// Seam over `DCAppAttestService` so the enrollment logic is testable without the real service.
/// Implementations throw `DeviceAttestationError` (already mapped).
public protocol AttestServiceBackend: Sendable {
    var isSupported: Bool { get }
    func generateKey() async throws -> String
    func attestKey(_ keyID: String, clientDataHash: Data) async throws -> Data
    func generateAssertion(_ keyID: String, clientDataHash: Data) async throws -> Data
}

#if canImport(DeviceCheck)
    /// Production backend. Stateless: `DCAppAttestService.shared` is read per call, so no non-Sendable
    /// reference is stored.
    public struct DCAppAttestBackend: AttestServiceBackend {
        public init() {}

        public var isSupported: Bool { DCAppAttestService.shared.isSupported }

        public func generateKey() async throws -> String {
            do { return try await DCAppAttestService.shared.generateKey() } catch { throw Self.map(error) }
        }

        public func attestKey(_ keyID: String, clientDataHash: Data) async throws -> Data {
            do {
                return try await DCAppAttestService.shared.attestKey(keyID, clientDataHash: clientDataHash)
            } catch { throw Self.map(error) }
        }

        public func generateAssertion(_ keyID: String, clientDataHash: Data) async throws -> Data {
            do {
                return try await DCAppAttestService.shared.generateAssertion(keyID, clientDataHash: clientDataHash)
            } catch { throw Self.map(error) }
        }

        static func map(_ error: any Error) -> DeviceAttestationError {
            if let known = error as? DeviceAttestationError { return known }
            guard let dcError = error as? DCError else { return .other(reason: String(describing: type(of: error))) }
            switch dcError.code {
            case .invalidKey: return .keyInvalid
            case .serverUnavailable: return .serverUnavailable
            case .featureUnsupported: return .unsupported
            case .invalidInput, .unknownSystemFailure: return .other(reason: "DCError \(dcError.code.rawValue)")
            @unknown default: return .other(reason: "DCError \(dcError.code.rawValue)")
            }
        }
    }
#endif

/// Live attester. An actor so concurrent callers share one key generation and one enrollment.
public actor AppAttestService: DeviceAttesting {
    public static let keyIDStorageKey = "app_attest_key_id"
    /// Holds the key id the server has confirmed; equal to `keyIDStorageKey`'s value once enrolled.
    public static let enrolledStorageKey = "app_attest_enrolled_key_id"

    public nonisolated let isSupported: Bool
    private let backend: any AttestServiceBackend
    private let store: any SecureStore
    private var keyTask: Task<String, any Error>?

    public init(backend: any AttestServiceBackend, store: any SecureStore) {
        self.backend = backend
        self.store = store
        self.isSupported = backend.isSupported
    }

    public func needsEnrollment() async -> Bool {
        guard isSupported else { return false }
        return !isEnrolled()
    }

    public func attestKeyIfNeeded(challenge: Data) async throws -> AttestationEnrollment? {
        guard isSupported, !isEnrolled() else { return nil }
        let hash = Data(SHA256.hash(data: challenge))
        do {
            return try await attest(challenge: challenge, hash: hash)
        } catch DeviceAttestationError.keyInvalid {
            // Unknown key (reinstall/restore) or one that was already attested but never confirmed: start over once.
            try clearStoredKey()
            return try await attest(challenge: challenge, hash: hash)
        }
    }

    public func confirmEnrollment() async throws {
        guard isSupported, let keyID = try readKeyID() else { return }
        do { try store.set(keyID, for: Self.enrolledStorageKey) } catch { throw storageError(error) }
    }

    public func assertion(for clientData: Data) async throws -> DeviceAssertion? {
        guard isSupported, isEnrolled(), let keyID = try readKeyID() else { return nil }
        do {
            let data = try await backend.generateAssertion(keyID, clientDataHash: AttestationClientData.hash(clientData))
            return DeviceAssertion(keyID: keyID, assertion: data)
        } catch DeviceAttestationError.keyInvalid {
            try clearStoredKey()
            throw DeviceAttestationError.keyInvalid
        }
    }

    /// Forgets the key. App Attest keys are per install and the server binds each to the user that enrolled
    /// it, so a different user signing in must enroll a fresh one (ADR-0016). A key generation already in
    /// flight may still persist its id afterwards; that key is unattested and is reused or replaced later.
    public func reset() async throws {
        keyTask = nil
        try clearStoredKey()
    }

    // MARK: - Private

    private func attest(challenge: Data, hash: Data) async throws -> AttestationEnrollment {
        let keyID = try await currentKeyID()
        let object = try await backend.attestKey(keyID, clientDataHash: hash)
        return AttestationEnrollment(keyID: keyID, attestationObject: object, challenge: challenge)
    }

    /// Reads the stored key id or generates one; concurrent callers await the same task (actor reentrancy).
    private func currentKeyID() async throws -> String {
        if let existing = try readKeyID() { return existing }
        if let keyTask { return try await keyTask.value }
        let backend = self.backend
        let store = self.store
        let task = Task<String, any Error> {
            let keyID = try await backend.generateKey()
            do { try store.set(keyID, for: Self.keyIDStorageKey) } catch {
                throw DeviceAttestationError.storage(reason: String(describing: type(of: error)))
            }
            return keyID
        }
        keyTask = task
        defer { keyTask = nil }
        return try await task.value
    }

    private func isEnrolled() -> Bool {
        guard let keyID = try? readKeyID(), let enrolled = try? store.get(Self.enrolledStorageKey) else { return false }
        return keyID == enrolled
    }

    private func readKeyID() throws -> String? {
        do { return try store.get(Self.keyIDStorageKey) } catch { throw storageError(error) }
    }

    private func clearStoredKey() throws {
        do {
            try store.remove(Self.keyIDStorageKey)
            try store.remove(Self.enrolledStorageKey)
        } catch { throw storageError(error) }
    }

    private func storageError(_ error: any Error) -> DeviceAttestationError {
        .storage(reason: String(describing: type(of: error)))
    }
}
