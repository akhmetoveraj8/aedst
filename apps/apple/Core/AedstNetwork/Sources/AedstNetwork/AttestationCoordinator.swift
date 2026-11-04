import AedstCore
import Foundation

/// What `AttestationCoordinator.assert` found out. Never an error: callers continue either way (fail-open).
public enum AssertionOutcome: Equatable, Sendable {
    /// The server verified the assertion for this exact action and payload.
    case verified
    /// The server understood the request and refused the evidence.
    case rejected(AttestationFailureReason)
    /// No verdict: unsupported device, not enrolled yet, invalid input, offline, server disabled, any error.
    case unavailable
}

/// What `AttestationCoordinator.enrollIfNeeded` did. Informational (logs, tests); the app ignores it.
public enum EnrollmentResult: Equatable, Sendable {
    case enrolled
    case alreadyEnrolled
    /// Unsupported device or simulator: no network call was made.
    case unsupported
    /// An enrollment was already attempted since launch / sign-in (no retry loops).
    case skipped
    case rejected(AttestationFailureReason)
    /// The challenge fetch, Apple's attestation, the enroll call or the key store failed.
    case failed
}

/// Drives the App Attest flow of ADR-0016 over `AppAttestRemote`:
///
///     needsEnrollment -> CreateChallenge -> attestKey(SHA-256(challenge)) -> Enroll -> confirmEnrollment
///     assert(action:payload:) -> generateAssertion(SHA-256(clientData)) -> VerifyAssertion
///
/// Fail-open everywhere: nothing here throws, nothing is shown to the user and no user flow waits for it.
/// Logs carry error categories and failure reasons only, never challenges, attestation objects, assertions,
/// payloads or key ids.
///
/// Rules:
/// - A challenge is used for exactly one `Enroll` call (the server burns it even on failure); a retry always
///   starts with a new `CreateChallenge`.
/// - At most one enrollment attempt per launch / sign-in (`reset()` re-arms it). A rejected or failed
///   enrollment is not retried in a loop.
/// - `KEY_ALREADY_ENROLLED` / `KEY_ID_MISMATCH` (enroll) and `KEY_UNKNOWN` (assert) discard the stored key so the
///   next attempt generates a new one.
public actor AttestationCoordinator {
    private let attestation: any DeviceAttesting
    private let remote: any AppAttestRemote
    private let bundleID: String
    private let logger: AedstLogger
    private var enrollmentAttempted = false
    /// Bumped by `reset()`; an enrollment that started before a reset must not confirm a key for the old user.
    private var epoch = 0

    /// - Parameter bundleID: the app's bundle identifier; the server validates it against its allow-list.
    ///   Empty means "the only allowed bundle id" server-side.
    public init(
        attestation: any DeviceAttesting,
        remote: any AppAttestRemote,
        bundleID: String,
        logger: AedstLogger = AedstLogger(category: "attestation")
    ) {
        self.attestation = attestation
        self.remote = remote
        self.bundleID = bundleID
        self.logger = logger
    }

    /// False on simulators and unsupported devices; those never touch the network.
    public nonisolated var isSupported: Bool { attestation.isSupported }

    @discardableResult
    public func enrollIfNeeded() async -> EnrollmentResult {
        guard attestation.isSupported else { return .unsupported }
        guard !enrollmentAttempted else { return .skipped }
        enrollmentAttempted = true
        guard await attestation.needsEnrollment() else { return .alreadyEnrolled }
        let startEpoch = epoch

        let challenge: Data
        switch await remote.createChallenge() {
        case .success(let value): challenge = value
        case .failure(let error):
            logger.info("App Attest: challenge unavailable (\(error.analyticsCategory))")
            return .failed
        }

        let enrollment: AttestationEnrollment
        do {
            guard let attested = try await attestation.attestKeyIfNeeded(challenge: challenge) else { return .alreadyEnrolled }
            enrollment = attested
        } catch {
            logger.info("App Attest: attestation failed (\(Self.category(of: error)))")
            return .failed
        }
        guard startEpoch == epoch else { return .skipped }

        let verdict = await remote.enroll(
            keyID: enrollment.keyID,
            attestationObject: enrollment.attestationObject,
            challenge: enrollment.challenge,
            bundleID: bundleID
        )
        switch verdict {
        case .failure(let error):
            logger.info("App Attest: enroll call failed (\(error.analyticsCategory))")
            return .failed
        case .success(.rejected(let reason)):
            logger.info("App Attest: enrollment rejected (\(reason.rawValue))")
            if startEpoch == epoch, reason == .keyAlreadyEnrolled || reason == .keyIDMismatch { await discardKey() }
            return .rejected(reason)
        case .success(.verified):
            guard startEpoch == epoch else { return .skipped }
            do {
                try await attestation.confirmEnrollment()
            } catch {
                logger.info("App Attest: could not persist enrollment (\(Self.category(of: error)))")
                return .failed
            }
            logger.info("App Attest: enrolled")
            return .enrolled
        }
    }

    /// Asks the device to vouch for exactly `action` + `payload` and has the server verify it. `action` must match
    /// `^[a-z][a-z0-9._-]*$` (1...64) and `payload` be at most 4096 bytes, otherwise `.unavailable` without a
    /// network call. Put a fresh random nonce or a request digest in `payload` if the statement must be unique.
    public func assert(action: String, payload: Data) async -> AssertionOutcome {
        guard attestation.isSupported else { return .unavailable }
        guard AttestationClientData.isValid(action: action), payload.count <= AttestationClientData.maxPayloadLength else {
            logger.info("App Attest: assertion input rejected locally")
            return .unavailable
        }

        let assertion: DeviceAssertion
        do {
            let clientData = AttestationClientData.make(action: action, payload: payload)
            guard let made = try await attestation.assertion(for: clientData) else { return .unavailable }
            assertion = made
        } catch {
            logger.info("App Attest: assertion unavailable (\(Self.category(of: error)))")
            return .unavailable
        }

        switch await remote.verifyAssertion(keyID: assertion.keyID, assertion: assertion.assertion, action: action, payload: payload) {
        case .failure(let error):
            logger.info("App Attest: verify call failed (\(error.analyticsCategory))")
            return .unavailable
        case .success(.verified):
            return .verified
        case .success(.rejected(let reason)):
            logger.info("App Attest: assertion rejected (\(reason.rawValue))")
            if reason == .keyUnknown {
                // Revoked or purged server-side: forget the key and allow one new enrollment.
                await discardKey()
                enrollmentAttempted = false
            }
            return .rejected(reason)
        }
    }

    /// Sign-out (or session expiry): the server binds a key to the user that enrolled it, so the next user must
    /// enroll a fresh one. Also re-arms the once-per-sign-in enrollment attempt.
    public func reset() async {
        epoch += 1
        enrollmentAttempted = false
        await discardKey()
    }

    private func discardKey() async {
        do { try await attestation.reset() } catch {
            logger.info("App Attest: could not discard key (\(Self.category(of: error)))")
        }
    }

    private static func category(of error: any Error) -> String {
        switch error as? DeviceAttestationError {
        case .unsupported: "unsupported"
        case .keyInvalid: "key_invalid"
        case .serverUnavailable: "apple_unavailable"
        case .storage: "storage"
        case .other, .none: "other"
        }
    }
}
