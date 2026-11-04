import Foundation

/// What `CapabilitiesService.GetCapabilities` says, reduced to what the app acts on (no generated types, so
/// `AedstCore` and the cache stay free of the Connect stubs). Behaviour: `docs/contract/behavior/capabilities.json`.
public struct ServerCapabilities: Codable, Sendable, Equatable {
    public struct Feature: Codable, Sendable, Equatable {
        public let enabled: Bool
        /// The proto's typed `required_client_version` (empty = none, mapped to nil): the oldest app release that may show the feature.
        public let requiredClientVersion: String?

        public init(enabled: Bool, requiredClientVersion: String? = nil) {
            self.enabled = enabled
            self.requiredClientVersion = requiredClientVersion
        }
    }

    /// The support window of one platform (`ClientVersions`); empty string = not configured.
    public struct ClientWindow: Codable, Sendable, Equatable {
        public let minimum: String
        public let recommended: String

        public init(minimum: String = "", recommended: String = "") {
            self.minimum = minimum
            self.recommended = recommended
        }
    }

    /// Mirrors `UpdateStatus`; anything the app does not know is `.unspecified`.
    public enum UpdateStatus: String, Codable, Sendable, Equatable {
        case unspecified, current, recommended
    }

    public let features: [String: Feature]
    public let clients: [String: ClientWindow]
    public let updateStatus: UpdateStatus

    public init(
        features: [String: Feature],
        clients: [String: ClientWindow] = [:],
        updateStatus: UpdateStatus = .unspecified
    ) {
        self.features = features
        self.clients = clients
        self.updateStatus = updateStatus
    }
}

/// Orders marketing versions (`1.4`, `1.4.0`, `2`) numerically, so `1.10.0 > 1.9.0` and `1.3 == 1.3.0`.
public enum VersionOrder {
    /// `nil` when either side is not 1-3 numeric components (the caller then treats the rule as not applicable).
    public static func compare(_ lhs: String, _ rhs: String) -> ComparisonResult? {
        guard let left = normalized(lhs), let right = normalized(rhs) else { return nil }
        return left.compare(right, options: .numeric)
    }

    private static func normalized(_ raw: String) -> String? {
        let parts = raw.trimmingCharacters(in: .whitespaces).split(separator: ".", omittingEmptySubsequences: false)
        guard (1...3).contains(parts.count),
              parts.allSatisfy({ !$0.isEmpty && $0.allSatisfy { $0.isASCII && $0.isNumber } })
        else { return nil }
        return (parts.map(String.init) + Array(repeating: "0", count: 3 - parts.count)).joined(separator: ".")
    }
}
