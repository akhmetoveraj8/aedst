import Foundation

/// The features this build contains, and which of them need the server's explicit consent.
public struct ClientBuild: Sendable, Equatable {
    /// Marketing version, e.g. `2.1.0`.
    public let version: String
    /// Feature ids compiled into the app.
    public let features: Set<String>
    /// Built features that stay hidden until the server enables them (no capabilities fetched = hidden).
    public let flagged: Set<String>

    public init(version: String, features: Set<String>, flagged: Set<String> = []) {
        self.version = version
        self.features = features
        self.flagged = flagged
    }
}

/// The five rules of `docs/contract/behavior/capabilities.json` as one pure function.
public enum CapabilityResolver {
    /// Shown iff built AND not switched off by the server (and old enough for `requiredClientVersion`).
    ///
    /// - `capabilities == nil`: nothing was ever fetched, so built-in features are on and flagged ones off.
    /// - A fetched response names features explicitly: `enabled` wins. A feature the response does not list falls
    ///   back to the same defaults (built-in on, flagged off). The server now lists one coarse entry per module id
    ///   (`tasks`, `media`, ...) besides dotted sub-capabilities (ADR-0009); unknown names are never looked up.
    public static func isEnabled(
        _ feature: String,
        build: ClientBuild,
        capabilities: ServerCapabilities?
    ) -> Bool {
        guard build.features.contains(feature) else { return false }
        let defaultValue = !build.flagged.contains(feature)
        guard let capabilities else { return defaultValue }
        guard let entry = capabilities.features[feature] else { return defaultValue }
        guard entry.enabled else { return false }
        if let required = entry.requiredClientVersion,
           VersionOrder.compare(build.version, required) == .orderedAscending {
            return false
        }
        return true
    }

    /// `true` when `build` is below the platform's minimum in `capabilities` (the server normally rejects such
    /// a call first with `CLIENT_UPGRADE_REQUIRED`; this covers a stale or cached window).
    public static func isBelowMinimum(build: ClientBuild, platform: String, capabilities: ServerCapabilities?) -> Bool {
        guard let minimum = capabilities?.clients[platform]?.minimum, !minimum.isEmpty else { return false }
        return VersionOrder.compare(build.version, minimum) == .orderedAscending
    }
}
