import AedstCore
import Foundation

/// `SessionStore` backed by a `SecureStore` (the Keychain in production).
///
/// - The whole session (user id + token pair + expiries) is ONE item, written
///   in one atomic call — there is no state where the access token belongs to
///   one login and the refresh token to another.
/// - Concurrent `refreshAccessToken()` calls share one in-flight refresh. The
///   task clears itself from *inside* the actor before its result is
///   published, so a late caller either joins the running refresh or starts a
///   fresh one — it can never observe a finished-but-stale task.
/// - A refresh that finishes after `save` or `clearTokens` (sign-out, or a new sign-in,
///   while the request was in flight) is discarded: it never resurrects or overwrites the
///   newer session (`generation`).
/// - Only a server rejection (`RefreshResult.rejected`) ends the session;
///   offline/5xx (`.unavailable`) keeps it.
/// - The decoded session is cached in memory, so an authenticated request
///   costs no Keychain read.
public actor KeychainTokenStore: SessionStore {
    public typealias RefreshHandler = @Sendable (_ refreshToken: String) async -> RefreshResult

    private struct StoredSession: Codable, Equatable {
        let userID: String
        let tokens: TokenPair
    }

    private static let sessionKey = "aedst.session.v1"

    public nonisolated let events: AsyncStream<SessionEvent>
    private let eventContinuation: AsyncStream<SessionEvent>.Continuation

    private let store: any SecureStore
    private let clock: any AedstClock
    private let refreshHandler: RefreshHandler
    private let logger = AedstLogger(category: "session")

    private var cache: StoredSession?
    private var isCacheLoaded = false
    private var refreshTask: Task<RefreshResult, Never>?
    /// Bumped by every `save` and `clearTokens`; a refresh started under an older value is stale.
    private var generation = 0

    public init(
        store: any SecureStore = Keychain(),
        clock: any AedstClock = SystemClock(),
        refreshHandler: @escaping RefreshHandler
    ) {
        self.store = store
        self.clock = clock
        self.refreshHandler = refreshHandler
        let stream = AsyncStream.makeStream(of: SessionEvent.self)
        self.events = stream.stream
        self.eventContinuation = stream.continuation
    }

    public func currentAccessToken() async -> String? {
        loadSession()?.tokens.accessToken
    }

    public func currentRefreshToken() async -> String? {
        loadSession()?.tokens.refreshToken
    }

    public func currentSession() async -> SessionSnapshot? {
        loadSession().map {
            SessionSnapshot(
                userID: $0.userID,
                accessTokenExpiresAt: $0.tokens.accessTokenExpiresAt,
                refreshTokenExpiresAt: $0.tokens.refreshTokenExpiresAt
            )
        }
    }

    public func save(_ tokens: TokenPair, userID: String) async throws {
        generation += 1
        try persist(StoredSession(userID: userID, tokens: tokens))
    }

    public func clearTokens() async {
        generation += 1
        cache = nil
        isCacheLoaded = true
        do {
            try store.remove(Self.sessionKey)
        } catch {
            logger.error("Failed to remove the stored session", error: error)
        }
    }

    public func refreshAccessToken() async -> RefreshResult {
        if let refreshTask {
            return await refreshTask.value
        }
        let task = Task { await self.performRefresh() }
        refreshTask = task
        return await task.value
    }

    private func performRefresh() async -> RefreshResult {
        defer { refreshTask = nil }

        guard let session = loadSession() else { return .rejected }
        // A locally-expired refresh token can never succeed: skip the round trip.
        guard session.tokens.refreshTokenExpiresAt > clock.now else {
            await endSession()
            return .rejected
        }

        let startedGeneration = generation
        let result = await refreshHandler(session.tokens.refreshToken)
        // The user signed out or signed in again while the request was in flight: the answer
        // belongs to a session that no longer exists, so it must not touch the store.
        guard startedGeneration == generation else { return result }
        switch result {
        case .refreshed(let tokens):
            // The server already rotated the refresh token, so the old one is dead. Adopt the new pair in memory
            // FIRST: if the Keychain write fails, the next request must still send the new tokens, or it would
            // present the rotated-out refresh token, be rejected and end the session. Only a relaunch loses it.
            let refreshed = StoredSession(userID: session.userID, tokens: tokens)
            cache = refreshed
            isCacheLoaded = true
            do {
                try write(refreshed)
            } catch {
                logger.error("Refreshed tokens could not be persisted", error: error)
            }
        case .rejected:
            await endSession()
        case .unavailable:
            break
        }
        return result
    }

    private func endSession() async {
        await clearTokens()
        eventContinuation.yield(.expired)
    }

    private func write(_ session: StoredSession) throws {
        let data = try JSONEncoder().encode(session)
        try store.set(String(decoding: data, as: UTF8.self), for: Self.sessionKey)
    }

    /// Writes through to the store, and only then updates the cache (a failed write leaves the old session).
    private func persist(_ session: StoredSession) throws {
        try write(session)
        cache = session
        isCacheLoaded = true
    }

    private func loadSession() -> StoredSession? {
        if isCacheLoaded { return cache }
        do {
            if let raw = try store.get(Self.sessionKey) {
                cache = try JSONDecoder().decode(StoredSession.self, from: Data(raw.utf8))
            }
        } catch {
            // Unreadable/corrupt item: treat as signed out rather than crash-looping.
            logger.error("Stored session is unreadable; treating as signed out", error: error)
            cache = nil
        }
        isCacheLoaded = true
        return cache
    }
}
