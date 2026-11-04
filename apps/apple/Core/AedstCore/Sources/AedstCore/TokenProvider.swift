import Foundation

/// An access/refresh token pair with absolute expiry instants. Expiries are
/// absolute (computed once, at issue time, from an injected `AedstClock`) so a
/// relaunch — or an offline start — can still tell whether a token is usable
/// without asking the server.
public struct TokenPair: Sendable, Codable, Equatable {
    public let accessToken: String
    public let refreshToken: String
    public let accessTokenExpiresAt: Date
    public let refreshTokenExpiresAt: Date

    public init(accessToken: String, refreshToken: String, accessTokenExpiresAt: Date, refreshTokenExpiresAt: Date) {
        self.accessToken = accessToken
        self.refreshToken = refreshToken
        self.accessTokenExpiresAt = accessTokenExpiresAt
        self.refreshTokenExpiresAt = refreshTokenExpiresAt
    }
}

/// Token-free view of the stored session — safe to hand to UI code.
public struct SessionSnapshot: Sendable, Equatable {
    public let userID: String
    public let accessTokenExpiresAt: Date
    public let refreshTokenExpiresAt: Date

    public init(userID: String, accessTokenExpiresAt: Date, refreshTokenExpiresAt: Date) {
        self.userID = userID
        self.accessTokenExpiresAt = accessTokenExpiresAt
        self.refreshTokenExpiresAt = refreshTokenExpiresAt
    }
}

/// Outcome of a token refresh. The three cases are deliberately distinct: only
/// `.rejected` (the server said the refresh token is dead) may end the session.
/// A transient failure (`.unavailable`: offline, timeout, 5xx) must keep the
/// session so the user is not signed out by a subway tunnel.
public enum RefreshResult: Sendable, Equatable {
    case refreshed(TokenPair)
    case rejected
    case unavailable
}

/// Session lifecycle notifications the UI reacts to.
public enum SessionEvent: Sendable, Equatable {
    /// The refresh token was rejected (or the stored session is unreadable):
    /// the user must sign in again.
    case expired
}

/// The seam `AedstNetwork` calls into to attach/refresh the bearer token.
/// Implemented by `AedstPersistence`'s Keychain-backed store. Lives in
/// `AedstCore` so neither `AedstNetwork` nor `AedstPersistence` depends on
/// the other.
public protocol TokenProvider: Sendable {
    func currentAccessToken() async -> String?
    /// Called by whichever request hit a 401 first; concurrent callers await
    /// the same in-flight refresh instead of each firing their own.
    func refreshAccessToken() async -> RefreshResult
    func clearTokens() async
}

/// `TokenProvider` plus the write side. Kept separate so a read-only
/// consumer can't accidentally overwrite the session.
public protocol SessionStore: TokenProvider {
    /// Atomically replaces the whole session (tokens and user id are one
    /// Keychain item, so a failure can never leave a mismatched pair).
    func save(_ tokens: TokenPair, userID: String) async throws
    /// Only the sign-out revocation (RFC 7009) needs the raw refresh token.
    func currentRefreshToken() async -> String?
    /// Token-free description of the stored session; works offline.
    func currentSession() async -> SessionSnapshot?
    /// Emits `.expired` when the server rejects the refresh token.
    var events: AsyncStream<SessionEvent> { get }
}
