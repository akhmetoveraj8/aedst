import AedstCore
import Foundation

/// Deterministic `SessionStore` double for feature-module unit tests that
/// exercise retry/refresh logic without a real Keychain-backed store.
public actor StubTokenProvider: SessionStore {
    public var accessToken: String?
    public var refreshResults: [RefreshResult]
    public private(set) var refreshCallCount = 0
    public private(set) var didClearTokens = false
    public private(set) var savedTokens: TokenPair?
    public private(set) var savedUserID: String?
    public var saveError: Error?

    public nonisolated let events: AsyncStream<SessionEvent>
    private let continuation: AsyncStream<SessionEvent>.Continuation

    /// `refreshResults` are consumed in order; the last one repeats.
    public init(accessToken: String? = nil, refreshResults: [RefreshResult] = [.unavailable]) {
        self.accessToken = accessToken
        self.refreshResults = refreshResults
        let stream = AsyncStream.makeStream(of: SessionEvent.self)
        self.events = stream.stream
        self.continuation = stream.continuation
    }

    public func currentAccessToken() async -> String? {
        accessToken
    }

    public func refreshAccessToken() async -> RefreshResult {
        refreshCallCount += 1
        let result = refreshResults.count > 1 ? refreshResults.removeFirst() : (refreshResults.first ?? .unavailable)
        switch result {
        case .refreshed(let pair):
            accessToken = pair.accessToken
        case .rejected:
            accessToken = nil
            continuation.yield(.expired)
        case .unavailable:
            break
        }
        return result
    }

    public func clearTokens() async {
        didClearTokens = true
        accessToken = nil
        savedTokens = nil
    }

    public func save(_ tokens: TokenPair, userID: String) async throws {
        if let saveError { throw saveError }
        savedTokens = tokens
        savedUserID = userID
        accessToken = tokens.accessToken
    }

    public func setSaveError(_ error: Error?) {
        saveError = error
    }

    public func currentRefreshToken() async -> String? {
        savedTokens?.refreshToken
    }

    public func currentSession() async -> SessionSnapshot? {
        guard let savedTokens, let savedUserID else { return nil }
        return SessionSnapshot(
            userID: savedUserID,
            accessTokenExpiresAt: savedTokens.accessTokenExpiresAt,
            refreshTokenExpiresAt: savedTokens.refreshTokenExpiresAt
        )
    }
}
