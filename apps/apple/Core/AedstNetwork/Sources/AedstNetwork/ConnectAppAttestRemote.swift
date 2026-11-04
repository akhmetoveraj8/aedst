import AedstCore
import Connect
import Foundation

/// `AppAttestRemote` over the generated `AppAttestService` client (`make generate`). Uses the authenticated
/// client: every RPC of the service requires a signed-in user.
public struct ConnectAppAttestRemote: AppAttestRemote {
    private let client: Aedst_Appattest_V1_AppAttestServiceClient
    private let executor: AuthorizedRequestExecutor

    /// `client` must be the authenticated `ProtocolClient`.
    public init(client: ProtocolClient, executor: AuthorizedRequestExecutor) {
        self.client = Aedst_Appattest_V1_AppAttestServiceClient(client: client)
        self.executor = executor
    }

    public func createChallenge() async -> Outcome<Data> {
        let client = self.client
        let request = Aedst_Appattest_V1_CreateChallengeRequest()
        let response = await executor.executeUnary { await client.createChallenge(request: request, headers: [:]) }
        return response.result
            .mapError { NetworkErrorMapping.map($0) }
            .flatMap { (message) -> Outcome<Data> in
                // proto: exactly 32 bytes; anything else is a broken server, not something to attest against.
                message.challenge.count == 32 ? .success(message.challenge) : .failure(.decoding(reason: "challenge length"))
            }
    }

    public func enroll(
        keyID: String,
        attestationObject: Data,
        challenge: Data,
        bundleID: String
    ) async -> Outcome<AttestationVerdict> {
        var request = Aedst_Appattest_V1_EnrollRequest()
        request.keyID = keyID
        request.attestationObject = attestationObject
        request.challenge = challenge
        request.bundleID = bundleID
        let client = self.client
        let response = await executor.executeUnary { await client.enroll(request: request, headers: [:]) }
        return response.result
            .map { Self.verdict(verified: $0.verified, reason: $0.reason) }
            .mapError { NetworkErrorMapping.map($0) }
    }

    public func verifyAssertion(
        keyID: String,
        assertion: Data,
        action: String,
        payload: Data
    ) async -> Outcome<AttestationVerdict> {
        var request = Aedst_Appattest_V1_VerifyAssertionRequest()
        request.keyID = keyID
        request.assertion = assertion
        request.action = action
        request.payload = payload
        let client = self.client
        let response = await executor.executeUnary { await client.verifyAssertion(request: request, headers: [:]) }
        return response.result
            .map { Self.verdict(verified: $0.verified, reason: $0.reason) }
            .mapError { NetworkErrorMapping.map($0) }
    }

    static func verdict(verified: Bool, reason: Aedst_Appattest_V1_FailureReason) -> AttestationVerdict {
        verified ? .verified : .rejected(Self.reason(reason))
    }

    static func reason(_ proto: Aedst_Appattest_V1_FailureReason) -> AttestationFailureReason {
        switch proto {
        case .challengeInvalid: .challengeInvalid
        case .bundleNotAllowed: .bundleNotAllowed
        case .attestationMalformed: .attestationMalformed
        case .certificateChainInvalid: .certificateChainInvalid
        case .nonceMismatch: .nonceMismatch
        case .keyIDMismatch: .keyIDMismatch
        case .appIDMismatch: .appIDMismatch
        case .counterNotZero: .counterNotZero
        case .aaguidInvalid: .aaguidInvalid
        case .environmentNotAllowed: .environmentNotAllowed
        case .keyAlreadyEnrolled: .keyAlreadyEnrolled
        case .keyUnknown: .keyUnknown
        case .assertionMalformed: .assertionMalformed
        case .signatureInvalid: .signatureInvalid
        case .counterNotIncreasing: .counterNotIncreasing
        case .unspecified, .UNRECOGNIZED: .unknown
        }
    }
}
