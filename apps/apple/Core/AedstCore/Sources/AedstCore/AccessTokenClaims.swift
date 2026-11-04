import Foundation

/// Unverified claims read from a JWT access token — for **UX decisions only**
/// (show the admin entry point, tag the crash reporter with the user id).
/// Authorization is always decided by `apps/server`, which verifies the
/// signature on every call; never gate anything sensitive on these values.
/// Mirrors `apps/web/src/shared/lib/auth/session-claims.ts`.
///
/// Roles follow the server's `AEDST_OIDC_ROLES_CLAIM` rules
/// (`apps/server/internal/platform/auth/oidc.go`): the claim is a top-level
/// name or a dotted path (Keycloak: `realm_access.roles`), and its value is an
/// array of strings, an object keyed by role name (Zitadel), or a
/// space-separated string.
public struct AccessTokenClaims: Sendable, Equatable {
    /// `sub`, when present.
    public let subject: String?
    /// `exp`, when present.
    public let expiresAt: Date?
    /// Roles found at `rolesClaim` (empty when absent).
    public let roles: Set<String>

    /// Default roles claim (same default as the server).
    public static let defaultRolesClaim = "roles"

    /// Parses the payload segment of `jwt`; `nil` when it is not a readable JWT.
    public init?(jwt: String, rolesClaim: String = AccessTokenClaims.defaultRolesClaim) {
        let segments = jwt.split(separator: ".", omittingEmptySubsequences: false)
        guard segments.count >= 2, let payload = Self.decodeBase64URL(String(segments[1])),
              let object = try? JSONSerialization.jsonObject(with: payload),
              let claims = object as? [String: Any]
        else { return nil }

        subject = claims["sub"] as? String
        expiresAt = (claims["exp"] as? NSNumber).map { Date(timeIntervalSince1970: $0.doubleValue) }
        roles = Self.roles(in: claims, claim: rolesClaim.isEmpty ? Self.defaultRolesClaim : rolesClaim)
    }

    /// `true` when `role` is present.
    public func hasRole(_ role: String) -> Bool {
        roles.contains(role)
    }

    static func roles(in claims: [String: Any], claim: String) -> Set<String> {
        if let value = claims[claim] {
            return rolesFromValue(value)
        }
        let path = claim.split(separator: ".").map(String.init)
        guard path.count > 1 else { return [] }
        var current: Any? = claims
        for key in path {
            guard let object = current as? [String: Any] else { return [] }
            current = object[key]
        }
        return current.map(rolesFromValue) ?? []
    }

    static func rolesFromValue(_ value: Any) -> Set<String> {
        switch value {
        case let array as [Any]:
            return Set(array.compactMap { $0 as? String })
        case let object as [String: Any]:
            return Set(object.keys)
        case let string as String:
            return Set(string.split(separator: " ").map(String.init))
        default:
            return []
        }
    }

    /// Decodes an unpadded base64url string (RFC 4648 section 5), as used by JWT segments.
    public static func decodeBase64URL(_ value: String) -> Data? {
        var base64 = value
            .replacingOccurrences(of: "-", with: "+")
            .replacingOccurrences(of: "_", with: "/")
        let remainder = base64.count % 4
        if remainder > 0 {
            base64 += String(repeating: "=", count: 4 - remainder)
        }
        return Data(base64Encoded: base64)
    }
}
