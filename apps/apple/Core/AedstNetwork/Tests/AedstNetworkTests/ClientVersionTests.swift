import AedstCore
import Connect
import Foundation
import Testing
@testable import AedstNetwork

// UNVERIFIED (never compiled): `ConnectError.Detail(type:payload:)`, `HTTPRequest`/`ResponseMessage` initializers
// are written against connect-swift 1.2.3's public API from its sources; the first Xcode build is the test.

/// Serialized `google.rpc.ErrorInfo { reason = 1; domain = 2 }`, as the server attaches it.
func errorInfoPayload(reason: String, domain: String = "aedst") -> Data {
    func field(_ number: UInt8, _ value: String) -> [UInt8] {
        [number << 3 | 2, UInt8(value.utf8.count)] + Array(value.utf8)
    }
    return Data(field(1, reason) + field(2, domain))
}

func upgradeRequiredError() -> ConnectError {
    ConnectError(
        code: .failedPrecondition,
        message: "this version of the apple app is no longer supported",
        exception: nil,
        details: [ConnectError.Detail(type: "google.rpc.ErrorInfo", payload: errorInfoPayload(reason: "CLIENT_UPGRADE_REQUIRED"))],
        metadata: [:]
    )
}

@Suite("ClientIdentity")
struct ClientIdentityTests {
    @Test("the header is apple/<semver>, padded to three components")
    func headerValue() {
        #expect(ClientIdentity(version: "2.10.0").headerValue == "apple/2.10.0")
        #expect(ClientIdentity(version: "2.1").headerValue == "apple/2.1.0")
        #expect(ClientIdentity(version: "3").headerValue == "apple/3.0.0")
        #expect(ClientIdentity(version: " 1.0.4 ").headerValue == "apple/1.0.4")
    }

    @Test("an unusable version sends no header instead of a made-up one the server would gate")
    func unusableVersion() {
        for raw in [nil, "", "$(MARKETING_VERSION)", "1.2.3.4", "1.x", "2.0.0-beta", "١.٢"] as [String?] {
            #expect(ClientIdentity(version: raw).headerValue == nil, "\(String(describing: raw))")
        }
    }

    @Test("applying sets X-Aedst-Client and keeps other headers; no version leaves headers alone")
    func applying() {
        let headers = ["Authorization": ["Bearer t"]]
        let with = ClientIdentity(version: "1.2.3").applying(to: headers)
        #expect(with["X-Aedst-Client"] == ["apple/1.2.3"])
        #expect(with["Authorization"] == ["Bearer t"])
        #expect(ClientIdentity(version: nil).applying(to: headers) == headers)
    }

    @Test("the Idempotency-Key header carries the outbox item id")
    func idempotencyKey() {
        #expect(IdempotencyKey.header(for: "item-1") == ["Idempotency-Key": ["item-1"]])
    }
}

@Suite("UpgradeRequiredDetection")
struct UpgradeRequiredDetectionTests {
    @Test("failed_precondition with the ErrorInfo reason maps to upgradeRequired")
    func mapsToUpgradeRequired() {
        #expect(NetworkErrorMapping.map(upgradeRequiredError()) == .upgradeRequired)
    }

    @Test("failed_precondition without the reason stays a validation error")
    func otherPreconditionsUnchanged() {
        let plain = ConnectError(code: .failedPrecondition, message: "bad state", exception: nil, details: [], metadata: [:])
        let otherReason = ConnectError(
            code: .failedPrecondition,
            message: nil,
            exception: nil,
            details: [ConnectError.Detail(type: "google.rpc.ErrorInfo", payload: errorInfoPayload(reason: "SOMETHING_ELSE"))],
            metadata: [:]
        )
        #expect(NetworkErrorMapping.map(plain) == .invalidInput(fields: ["bad state"]))
        #expect(NetworkErrorMapping.map(otherReason) == .invalidInput(fields: ["request"]))
    }

    @Test("the reason alone is not enough: the code must be failed_precondition")
    func codeMustMatch() {
        let error = ConnectError(
            code: .invalidArgument,
            message: nil,
            exception: nil,
            details: [ConnectError.Detail(type: "google.rpc.ErrorInfo", payload: errorInfoPayload(reason: "CLIENT_UPGRADE_REQUIRED"))],
            metadata: [:]
        )
        #expect(NetworkErrorMapping.map(error) != .upgradeRequired)
    }

    @Test("the wire reader finds field 1, skips other fields and survives garbage")
    func wireReader() {
        #expect(UpgradeRequiredDetection.errorInfoReason(errorInfoPayload(reason: "X")) == "X")
        // field 2 first, then field 1
        let swapped = Data([0x12, 0x01, 0x61, 0x0A, 0x01, 0x42])
        #expect(UpgradeRequiredDetection.errorInfoReason(swapped) == "B")
        #expect(UpgradeRequiredDetection.errorInfoReason(Data()) == nil)
        #expect(UpgradeRequiredDetection.errorInfoReason(Data([0x0A, 0x7F, 0x41])) == nil) // length past the end
        #expect(UpgradeRequiredDetection.errorInfoReason(Data([0xFF, 0xFF])) == nil) // truncated varint
    }
}
