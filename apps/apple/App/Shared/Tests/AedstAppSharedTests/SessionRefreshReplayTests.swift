import AedstCore
import AedstNetwork
import AedstPersistence
import AedstTesting
import Connect
import Foundation
import Testing

// UNVERIFIED (never compiled): `ResponseMessage(code:headers:result:trailers:)` and `ConnectError(...)` initializers
// are written against connect-swift 1.2.3's public API.

/// Replays `docs/contract/behavior/session-refresh.json` against the real `AuthorizedRequestExecutor` and the real
/// `KeychainTokenStore` (in-memory `SecureStore`), so single-flight, sign-out and keep-session rules are the
/// production ones. Lives in App/Shared because it is the only test target that sees both modules.
private struct SessionFixture: Decodable {
    struct Case: Decodable {
        struct Request: Decodable {
            let id: String
            let server: [Int]
        }

        struct Expect: Decodable, Equatable {
            let refreshCalls: Int
            let results: [String: String]
            let session: String
            let replays: [String: Int]
        }

        let id: String
        let requests: [Request]
        let refresh: [String]
        let expect: Expect
    }

    let cases: [Case]
}

@Suite("session-refresh behaviour fixture")
struct SessionRefreshReplayTests {
    @Test("every case in the fixture behaves as written")
    func replaysEveryCase() async throws {
        let fixture = try BehaviorFixture.load(SessionFixture.self, named: "session-refresh")
        #expect(!fixture.cases.isEmpty)
        for fixtureCase in fixture.cases {
            let actual = await run(fixtureCase)
            #expect(actual == fixtureCase.expect, "\(fixtureCase.id): got \(actual)")
        }
    }

    private func run(_ fixtureCase: SessionFixture.Case) async -> SessionFixture.Case.Expect {
        let now = Date(timeIntervalSince1970: 1_000_000)
        let world = World(refreshOutcomes: fixtureCase.refresh, concurrentRequests: fixtureCase.requests.count)
        let store = KeychainTokenStore(
            store: InMemorySecureStore(),
            clock: ManualClock(now: now),
            refreshHandler: { _ in await world.refresh(issuedAt: now) }
        )
        try? await store.save(
            TokenPair(
                accessToken: "old",
                refreshToken: "old-refresh",
                accessTokenExpiresAt: now.addingTimeInterval(-1),
                refreshTokenExpiresAt: now.addingTimeInterval(86_400)
            ),
            userID: "user-1"
        )
        let executor = AuthorizedRequestExecutor(tokenProvider: store)

        var results: [String: String] = [:]
        await withTaskGroup(of: (String, String).self) { group in
            for request in fixtureCase.requests {
                group.addTask {
                    let response = await executor.executeUnary { await world.call(request.id, script: request.server) }
                    return (request.id, Self.classify(response))
                }
            }
            for await (id, outcome) in group { results[id] = outcome }
        }

        return SessionFixture.Case.Expect(
            refreshCalls: await world.refreshCalls,
            results: results,
            session: await store.currentSession() == nil ? "signed_out" : "signed_in",
            replays: await world.replays(for: fixtureCase.requests.map(\.id))
        )
    }

    private static func classify(_ response: ResponseMessage<Google_Protobuf_Empty>) -> String {
        switch response.result {
        case .success:
            return "ok"
        case .failure(let error):
            let mapped = NetworkErrorMapping.map(error)
            if mapped == .unauthenticated { return "unauthenticated" }
            return mapped.isRetryable ? "retryable_error" : "error"
        }
    }
}

/// The scripted server and IdP of one fixture case.
private actor World {
    private var refreshOutcomes: [String]
    private let concurrentRequests: Int
    private var firstResponsesServed = 0
    private var callsByRequest: [String: Int] = [:]
    private(set) var refreshCalls = 0

    init(refreshOutcomes: [String], concurrentRequests: Int) {
        self.refreshOutcomes = refreshOutcomes
        self.concurrentRequests = concurrentRequests
    }

    func replays(for ids: [String]) -> [String: Int] {
        Dictionary(uniqueKeysWithValues: ids.map { ($0, max((callsByRequest[$0] ?? 0) - 1, 0)) })
    }

    /// One HTTP exchange for request `id`: the n-th call returns the n-th scripted status.
    func call(_ id: String, script: [Int]) -> ResponseMessage<Google_Protobuf_Empty> {
        let index = callsByRequest[id, default: 0]
        callsByRequest[id] = index + 1
        if index == 0 { firstResponsesServed += 1 }
        let status = index < script.count ? script[index] : 500
        return status == 200
            ? ResponseMessage(code: .ok, headers: [:], result: .success(Google_Protobuf_Empty()), trailers: [:])
            : ResponseMessage(
                code: .unauthenticated,
                headers: [:],
                result: .failure(
                    ConnectError(code: .unauthenticated, message: nil, exception: nil, details: [], metadata: [:])
                ),
                trailers: [:]
            )
    }

    /// The IdP token endpoint. Holds the answer back until every request has seen its first 401, so concurrent
    /// 401s really overlap and only single-flight can keep `refreshCalls` at 1.
    func refresh(issuedAt now: Date) async -> RefreshResult {
        refreshCalls += 1
        let outcome = refreshOutcomes.isEmpty ? "transient" : refreshOutcomes.removeFirst()
        while firstResponsesServed < concurrentRequests { await Task.yield() }
        try? await Task.sleep(nanoseconds: 30_000_000) // let late joiners reach the in-flight refresh
        switch outcome {
        case "ok":
            return .refreshed(
                TokenPair(
                    accessToken: "new",
                    refreshToken: "new-refresh",
                    accessTokenExpiresAt: now.addingTimeInterval(900),
                    refreshTokenExpiresAt: now.addingTimeInterval(86_400)
                )
            )
        case "invalid_grant":
            return .rejected
        default:
            return .unavailable
        }
    }
}
