import CryptoKit
import Foundation

/// Client-data convention shared with the server (`aedst.appattest.v1`, see the comment above
/// `VerifyAssertionRequest` in `apps/server/api/proto/aedst/appattest/v1/appattest.proto` and ADR-0016):
///
///     clientData     = "aedst.appattest.v1" LF action LF payload      (LF = 0x0A, payload = raw bytes)
///     clientDataHash = SHA-256(clientData)
///
/// The device passes `clientDataHash` to `generateAssertion`; the server rebuilds `clientData` from the
/// `action` and `payload` it receives. Changing this layout needs a new server tag, never a silent edit.
public enum AttestationClientData {
    public static let tag = "aedst.appattest.v1"
    /// Proto limits (`VerifyAssertionRequest.action` 1...64, `payload` at most 4096 bytes).
    public static let maxActionLength = 64
    public static let maxPayloadLength = 4096

    public static func make(action: String, payload: Data) -> Data {
        var out = Data(tag.utf8)
        out.append(0x0A)
        out.append(contentsOf: action.utf8)
        out.append(0x0A)
        out.append(payload)
        return out
    }

    public static func hash(_ clientData: Data) -> Data {
        Data(SHA256.hash(data: clientData))
    }

    /// `^[a-z][a-z0-9._-]*$`, 1...64 bytes: the server rejects anything else with INVALID_ARGUMENT, so the
    /// client checks first and never spends an assertion counter on a request that cannot verify.
    public static func isValid(action: String) -> Bool {
        let bytes = Array(action.utf8)
        guard let first = bytes.first, (1...maxActionLength).contains(bytes.count), (0x61...0x7A).contains(first) else {
            return false
        }
        return bytes.dropFirst().allSatisfy { byte in
            (0x61...0x7A).contains(byte) || (0x30...0x39).contains(byte) || byte == 0x2E || byte == 0x5F || byte == 0x2D
        }
    }
}
