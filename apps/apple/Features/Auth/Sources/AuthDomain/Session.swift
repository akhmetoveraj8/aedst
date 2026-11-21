import Foundation

/// The `auth` module's session concept on the client — mirrors
/// `apps/server/api/proto/aedst/auth/v1`'s `LoginResponse`/`TokenPair`
/// without leaking the wire format (or the tokens themselves) into `Presentation`.
public struct Session: Sendable, Equatable {
    public let userID: String
    public let accessTokenExpiresAt: Date
    public let refreshTokenExpiresAt: Date

    public init(userID: String, accessTokenExpiresAt: Date, refreshTokenExpiresAt: Date) {
        self.userID = userID
        self.accessTokenExpiresAt = accessTokenExpiresAt
        self.refreshTokenExpiresAt = refreshTokenExpiresAt
    }

    /// Time is passed in (from an `AedstClock`), never read from the wall clock here.
    public func isAccessTokenExpired(at now: Date) -> Bool {
        accessTokenExpiresAt <= now
    }

    /// Once the refresh token has expired the user must sign in again.
    public func isRefreshTokenExpired(at now: Date) -> Bool {
        refreshTokenExpiresAt <= now
    }
}
