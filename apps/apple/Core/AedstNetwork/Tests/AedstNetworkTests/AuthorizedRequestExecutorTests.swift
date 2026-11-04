import AedstCore
import AedstTesting
import Testing
@testable import AedstNetwork

@Suite("AuthorizedRequestExecutor")
struct AuthorizedRequestExecutorTests {
    private static let pair = TokenPair(
        accessToken: "new-access",
        refreshToken: "new-refresh",
        accessTokenExpiresAt: .distantFuture,
        refreshTokenExpiresAt: .distantFuture
    )

    @Test("a successful call is not retried and never refreshes")
    func passesThrough() async {
        let provider = StubTokenProvider(accessToken: "a")
        let calls = CallLog(responses: [200])

        let result = await AuthorizedRequestExecutor(tokenProvider: provider)
            .execute({ await calls.next() }, isUnauthenticated: { $0 == 401 })

        #expect(result == 200)
        #expect(await calls.count == 1)
        #expect(await provider.refreshCallCount == 0)
    }

    @Test("a 401 refreshes once and re-issues the original call")
    func retriesAfterRefresh() async {
        let provider = StubTokenProvider(accessToken: "old", refreshResults: [.refreshed(Self.pair)])
        let calls = CallLog(responses: [401, 200])

        let result = await AuthorizedRequestExecutor(tokenProvider: provider)
            .execute({ await calls.next() }, isUnauthenticated: { $0 == 401 })

        #expect(result == 200)
        #expect(await calls.count == 2)
        #expect(await provider.refreshCallCount == 1)
    }

    @Test("a 401 after a successful refresh is returned, not retried forever")
    func retriesOnlyOnce() async {
        let provider = StubTokenProvider(accessToken: "old", refreshResults: [.refreshed(Self.pair)])
        let calls = CallLog(responses: [401, 401, 200])

        let result = await AuthorizedRequestExecutor(tokenProvider: provider)
            .execute({ await calls.next() }, isUnauthenticated: { $0 == 401 })

        #expect(result == 401)
        #expect(await calls.count == 2)
    }

    @Test("a rejected refresh returns the original failure without retrying")
    func rejectedRefresh() async {
        let provider = StubTokenProvider(accessToken: "old", refreshResults: [.rejected])
        let calls = CallLog(responses: [401, 200])

        let result = await AuthorizedRequestExecutor(tokenProvider: provider)
            .execute({ await calls.next() }, isUnauthenticated: { $0 == 401 })

        #expect(result == 401)
        #expect(await calls.count == 1)
    }

    @Test("an unavailable refresh (offline) returns the original failure without retrying")
    func unavailableRefresh() async {
        let provider = StubTokenProvider(accessToken: "old", refreshResults: [.unavailable])
        let calls = CallLog(responses: [401, 200])

        let result = await AuthorizedRequestExecutor(tokenProvider: provider)
            .execute({ await calls.next() }, isUnauthenticated: { $0 == 401 })

        #expect(result == 401)
        #expect(await calls.count == 1)
    }

    @Test("an unavailable refresh lets the caller re-label the failure as transient")
    func unavailableRefreshIsRelabelled() async {
        let provider = StubTokenProvider(accessToken: "old", refreshResults: [.unavailable])
        let calls = CallLog(responses: [401, 200])

        let result = await AuthorizedRequestExecutor(tokenProvider: provider)
            .execute({ await calls.next() }, isUnauthenticated: { $0 == 401 }, whenRefreshUnavailable: { _ in 503 })

        #expect(result == 503)
        #expect(await calls.count == 1)
    }

    @Test("a rejected refresh does not use the transient re-labelling")
    func rejectedRefreshKeepsOriginal() async {
        let provider = StubTokenProvider(accessToken: "old", refreshResults: [.rejected])
        let calls = CallLog(responses: [401])

        let result = await AuthorizedRequestExecutor(tokenProvider: provider)
            .execute({ await calls.next() }, isUnauthenticated: { $0 == 401 }, whenRefreshUnavailable: { _ in 503 })

        #expect(result == 401)
    }
}

private actor CallLog {
    private var responses: [Int]
    private(set) var count = 0

    init(responses: [Int]) {
        self.responses = responses
    }

    func next() -> Int {
        count += 1
        return responses.isEmpty ? 500 : responses.removeFirst()
    }
}
