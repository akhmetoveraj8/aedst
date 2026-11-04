import Foundation

/// What this app sends in `X-Aedst-Client` on every request: `apple/<semver>` (ADR-0009, behaviour
/// `client-identification`). The server uses it for metrics and the minimum-version gate; it is not
/// authentication. The version is the bundle's `CFBundleShortVersionString` (`MARKETING_VERSION`).
public struct ClientIdentity: Sendable, Equatable {
    public static let headerName = "X-Aedst-Client"
    /// The platform token the server's `AEDST_MIN_CLIENT_VERSIONS` knows for this client.
    public static let platform = "apple"

    /// The header value, or `nil` when the bundle has no usable version. Omitting the header is safe: the server
    /// lets an unidentified client through, whereas a made-up version such as `0.0.0` would be gated.
    public let headerValue: String?

    /// - Parameter version: a marketing version such as `2.1`, `2.1.0` or `3`; anything that is not 1-3 numeric
    ///   components (an unresolved `$(MARKETING_VERSION)`, a pre-release tag) yields no header.
    public init(version: String?) {
        self.headerValue = Self.semver(from: version).map { "\(Self.platform)/\($0)" }
    }

    /// Reads the version from the bundle's Info.plist.
    public static func fromBundle(_ bundle: Bundle = .main) -> ClientIdentity {
        ClientIdentity(version: bundle.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String)
    }

    /// `1.2` -> `1.2.0`; `nil` when the string is not 1-3 dot-separated non-negative integers.
    static func semver(from raw: String?) -> String? {
        guard let raw else { return nil }
        let parts = raw.trimmingCharacters(in: .whitespaces).split(separator: ".", omittingEmptySubsequences: false)
        guard (1...3).contains(parts.count),
              parts.allSatisfy({ !$0.isEmpty && $0.allSatisfy(\.isASCII) && $0.allSatisfy(\.isNumber) })
        else { return nil }
        return (parts.map(String.init) + Array(repeating: "0", count: 3 - parts.count)).joined(separator: ".")
    }

    /// `headers` with the identification header set (unchanged when there is no version).
    func applying(to headers: [String: [String]]) -> [String: [String]] {
        guard let headerValue else { return headers }
        var headers = headers
        headers[Self.headerName] = [headerValue]
        return headers
    }
}
