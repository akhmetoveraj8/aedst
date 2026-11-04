import AedstCore
import Foundation

/// Why the server did not accept an attestation or an assertion (`FailureReason` in
/// `aedst/appattest/v1/appattest.proto`). Only the coarse category is kept; it is safe to log.
public enum AttestationFailureReason: String, Equatable, Sendable {
    case challengeInvalid
    case bundleNotAllowed
    case attestationMalformed
    case certificateChainInvalid
    case nonceMismatch
    case keyIDMismatch
    case appIDMismatch
    case counterNotZero
    case aaguidInvalid
    case environmentNotAllowed
    case keyAlreadyEnrolled
    case keyUnknown
    case assertionMalformed
    case signatureInvalid
    case counterNotIncreasing
    /// `FAILURE_REASON_UNSPECIFIED` or a value newer than this client knows.
    case unknown
}

/// The server's answer to `Enroll` / `VerifyAssertion`. A bad attestation is a normal response, not an RPC
/// error (proto comment), so it is a value here and not an `AedstError`.
public enum AttestationVerdict: Equatable, Sendable {
    case verified
    case rejected(AttestationFailureReason)
}

/// Transport seam for `AppAttestService`. `Outcome.failure` means the call itself failed (offline, rate
/// limited, feature disabled on the server, bad request); evidence that the server rejected is a `.rejected`
/// verdict inside `.success`.
public protocol AppAttestRemote: Sendable {
    /// A fresh single-use 32-byte challenge bound to the signed-in user (valid 5 minutes).
    func createChallenge() async -> Outcome<Data>

    /// `bundleID` may be empty: the server then uses its only allowed bundle id.
    func enroll(keyID: String, attestationObject: Data, challenge: Data, bundleID: String) async -> Outcome<AttestationVerdict>

    func verifyAssertion(keyID: String, assertion: Data, action: String, payload: Data) async -> Outcome<AttestationVerdict>
}
