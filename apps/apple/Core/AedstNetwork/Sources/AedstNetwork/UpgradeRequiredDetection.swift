import Connect
import Foundation

/// Recognises the server's forced-upgrade answer: Connect code `failed_precondition` with a
/// `google.rpc.ErrorInfo` detail whose `reason` is `CLIENT_UPGRADE_REQUIRED`
/// (`apps/server/internal/platform/httpserver/clientversion.go`, behaviour `forced-upgrade-ux`).
///
/// `ErrorInfo` is not among the generated stubs (`buf.gen.yaml` generates only `aedst/*`), so `reason`
/// (field 1, a string) is read straight from the protobuf wire bytes of the detail instead of adding a
/// generated type or dependency for one field. Do not match on the message text: it is for humans.
enum UpgradeRequiredDetection {
    static let reason = "CLIENT_UPGRADE_REQUIRED"
    private static let errorInfoType = "google.rpc.ErrorInfo"

    static func isUpgradeRequired(_ error: ConnectError) -> Bool {
        guard error.code == .failedPrecondition else { return false }
        return error.details.contains { detail in
            detail.type.hasSuffix(errorInfoType) && detail.payload.flatMap(errorInfoReason) == reason
        }
    }

    /// `ErrorInfo.reason` (field 1) from the serialized message, or `nil` when absent or malformed.
    static func errorInfoReason(_ payload: Data) -> String? {
        let bytes = [UInt8](payload)
        var index = 0
        while index < bytes.count {
            guard let tag = readVarint(bytes, &index) else { return nil }
            let field = tag >> 3
            switch tag & 0x7 {
            case 0: // varint
                guard readVarint(bytes, &index) != nil else { return nil }
            case 1: // 64-bit
                index += 8
            case 2: // length-delimited
                guard let length = readVarint(bytes, &index), length <= UInt64(bytes.count - index) else { return nil }
                let end = index + Int(length)
                if field == 1 { return String(bytes: bytes[index..<end], encoding: .utf8) }
                index = end
            case 5: // 32-bit
                index += 4
            default:
                return nil
            }
        }
        return nil
    }

    private static func readVarint(_ bytes: [UInt8], _ index: inout Int) -> UInt64? {
        var result: UInt64 = 0
        var shift: UInt64 = 0
        while index < bytes.count, shift < 64 {
            let byte = bytes[index]
            index += 1
            result |= UInt64(byte & 0x7F) << shift
            if byte & 0x80 == 0 { return result }
            shift += 7
        }
        return nil
    }
}
