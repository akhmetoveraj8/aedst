import AedstCore
import AedstTesting
import Foundation
import Testing
@testable import AedstPersistence

@Suite("KeychainTokenStore")
struct KeychainTokenStoreTests {
    private let now = Date(timeIntervalSince1970: 1_000_000)

    private func pair(_ tag: String, refreshValidFor: TimeInterval = 3_600) -> TokenPair {
        TokenPair(
            accessToken: "access-\(tag)",
            refreshToken: "refresh-\(tag)",
            accessTokenExpiresAt: now.addingTimeInterval(300),
            refreshTokenExpiresAt: now.addingTimeInterval(refreshValidFor)
        )
    }

    private func makeStore(
        store: InMemorySecureStore = InMemorySecureStore(),
        handler: @escaping KeychainTokenStore.RefreshHandler
    ) -> KeychainTokenStore {
        KeychainTokenStore(store: store, clock: ManualClock(now: now), refreshHandler: handler)
    }

    @Test("dedupes concurrent refresh calls into one handler invocation")
    func dedupesConcurrentRefresh() async throws {
        let calls = Counter()
        let fresh = pair("new")
        let store = makeStore { _ in
            await calls.increment()
            try? await Task.sleep(nanoseconds: 50_000_000)
            return .refreshed(fresh)
        }
        try await store.save(pair("old"), userID: "u1")

        async let first = store.refreshAccessToken()
        async let second = store.refreshAccessToken()
        async let third = store.refreshAccessToken()
        let results = await [first, second, third]

        #expect(results.allSatisfy { $0 == .refreshed(fresh) })
        #expect(await calls.value == 1)
        #expect(await store.currentAccessToken() == "access-new")
    }

    @Test("a refresh whose Keychain write fails still keeps the rotated tokens in memory")
    func refreshKeepsNewTokensWhenWriteFails() async throws {
        let backing = InMemorySecureStore()
        let fresh = pair("new")
        let store = makeStore(store: backing) { _ in .refreshed(fresh) }
        try await store.save(pair("old"), userID: "u1")

        backing.setFailWrites(true)
        let result = await store.refreshAccessToken()

        #expect(result == .refreshed(fresh))
        // The next request must send the new pair, not the rotated-out refresh token.
        #expect(await store.currentAccessToken() == "access-new")
        #expect(await store.currentRefreshToken() == "refresh-new")
    }

    @Test("a later refresh after the first finished starts a new one")
    func sequentialRefreshesAreIndependent() async throws {
        let calls = Counter()
        let fresh = pair("n")
        let store = makeStore { _ in
            await calls.increment()
            return .refreshed(fresh)
        }
        try await store.save(pair("old"), userID: "u1")

        _ = await store.refreshAccessToken()
        _ = await store.refreshAccessToken()

        #expect(await calls.value == 2)
    }

    @Test("the refresh handler receives the stored refresh token")
    func passesStoredRefreshToken() async throws {
        let seen = Recorder()
        let store = makeStore { token in
            await seen.record(token)
            return .unavailable
        }
        try await store.save(pair("old"), userID: "u1")

        _ = await store.refreshAccessToken()

        #expect(await seen.values == ["refresh-old"])
    }

    @Test("a rejected refresh clears the session and emits .expired")
    func rejectedEndsSession() async throws {
        let store = makeStore { _ in .rejected }
        try await store.save(pair("old"), userID: "u1")

        let result = await store.refreshAccessToken()
        var iterator = store.events.makeAsyncIterator()

        // Awaited outside #expect: a `var` iterator mutated inside the macro's closure is avoidable.
        let event = await iterator.next()

        #expect(result == .rejected)
        #expect(await store.currentSession() == nil)
        #expect(event == .expired)
    }

    @Test("a transient failure keeps the session")
    func unavailableKeepsSession() async throws {
        let store = makeStore { _ in .unavailable }
        try await store.save(pair("old"), userID: "u1")

        let result = await store.refreshAccessToken()

        #expect(result == .unavailable)
        #expect(await store.currentAccessToken() == "access-old")
    }

    @Test("a locally expired refresh token is rejected without calling the server")
    func expiredRefreshTokenSkipsNetwork() async throws {
        let calls = Counter()
        let fresh = pair("new")
        let store = makeStore { _ in
            await calls.increment()
            return .refreshed(fresh)
        }
        try await store.save(pair("old", refreshValidFor: -1), userID: "u1")

        #expect(await store.refreshAccessToken() == .rejected)
        #expect(await calls.value == 0)
    }

    @Test("with no session there is nothing to refresh")
    func noSession() async {
        let fresh = pair("x")
        let store = makeStore { _ in .refreshed(fresh) }
        #expect(await store.refreshAccessToken() == .rejected)
    }

    @Test("tokens and user id are one item and survive a new store instance")
    func persistsAtomically() async throws {
        let backing = InMemorySecureStore()
        let first = makeStore(store: backing) { _ in .unavailable }
        try await first.save(pair("a"), userID: "user-42")

        let second = makeStore(store: backing) { _ in .unavailable }
        let snapshot = await second.currentSession()

        #expect(snapshot?.userID == "user-42")
        #expect(await second.currentRefreshToken() == "refresh-a")
    }

    @Test("a failed write is thrown to the caller and leaves the previous session intact")
    func writeFailureIsSurfaced() async throws {
        let backing = InMemorySecureStore()
        let store = makeStore(store: backing) { _ in .unavailable }
        try await store.save(pair("good"), userID: "u1")

        backing.setFailWrites(true)
        await #expect(throws: InMemorySecureStore.WriteFailure.self) {
            try await store.save(pair("bad"), userID: "u1")
        }

        #expect(await store.currentAccessToken() == "access-good")
    }

    @Test("a corrupt stored item is treated as signed out, not a crash")
    func corruptItem() async {
        let backing = InMemorySecureStore(values: ["aedst.session.v1": "not json"])
        let store = makeStore(store: backing) { _ in .unavailable }

        #expect(await store.currentSession() == nil)
        #expect(await store.currentAccessToken() == nil)
    }

    @Test("clearTokens removes the session")
    func clear() async throws {
        let backing = InMemorySecureStore()
        let store = makeStore(store: backing) { _ in .unavailable }
        try await store.save(pair("a"), userID: "u1")

        await store.clearTokens()

        #expect(await store.currentSession() == nil)
        #expect(backing.isEmpty)
    }

    @Test("a refresh that finishes after sign-out does not resurrect the session")
    func staleRefreshAfterClear() async throws {
        let started = Counter()
        let gate = Gate()
        let late = pair("late")
        let store = makeStore { _ in
            await started.increment()
            await gate.wait()
            return .refreshed(late)
        }
        try await store.save(pair("old"), userID: "u1")

        let refresh = Task { await store.refreshAccessToken() }
        while await started.value == 0 { await Task.yield() }
        await store.clearTokens()
        await gate.open()
        _ = await refresh.value

        #expect(await store.currentSession() == nil)
        #expect(await store.currentAccessToken() == nil)
    }

    @Test("a refresh that finishes after a new sign-in does not overwrite the new session")
    func staleRefreshAfterSignIn() async throws {
        let started = Counter()
        let gate = Gate()
        let late = pair("late")
        let store = makeStore { _ in
            await started.increment()
            await gate.wait()
            return .refreshed(late)
        }
        try await store.save(pair("old"), userID: "u1")

        let refresh = Task { await store.refreshAccessToken() }
        while await started.value == 0 { await Task.yield() }
        try await store.save(pair("fresh"), userID: "u2")
        await gate.open()
        _ = await refresh.value

        #expect(await store.currentAccessToken() == "access-fresh")
        #expect(await store.currentSession()?.userID == "u2")
    }
}

private actor Gate {
    private var isOpen = false
    private var waiters: [CheckedContinuation<Void, Never>] = []

    func wait() async {
        if isOpen { return }
        await withCheckedContinuation { waiters.append($0) }
    }

    func open() {
        isOpen = true
        waiters.forEach { $0.resume() }
        waiters.removeAll()
    }
}

private actor Counter {
    private(set) var value = 0
    func increment() { value += 1 }
}

private actor Recorder {
    private(set) var values: [String] = []
    func record(_ value: String) { values.append(value) }
}
