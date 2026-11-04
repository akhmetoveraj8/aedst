import AedstCore
import AedstTesting
import Foundation
import SwiftUI
import Testing
@testable import AedstAppShared

@Suite("RootViewModel")
@MainActor
struct RootViewModelTests {
    private let now = Date(timeIntervalSince1970: 1_000_000)

    private func signedInStore() async throws -> InMemorySecureStore {
        // Persist a session through the real token store, exactly as login would.
        let store = InMemorySecureStore()
        let dependencies = makeDependencies(secureStore: store)
        try await dependencies.sessionStore.save(makeTokens(now: now), userID: "user-1")
        return store
    }

    @Test("starts signed out when nothing is stored")
    func signedOut() async {
        let model = RootViewModel(dependencies: makeDependencies())
        await model.restore()

        #expect(!model.isSignedIn)
        #expect(!model.isLocked)
    }

    @Test("restores a persisted session without any network call")
    func restoresSession() async throws {
        let store = try await signedInStore()
        let model = RootViewModel(dependencies: makeDependencies(secureStore: store))

        await model.restore()

        #expect(model.session?.userID == "user-1")
    }

    @Test("an expired refresh token restores as signed out")
    func expiredRefreshToken() async throws {
        let store = InMemorySecureStore()
        let clock = ManualClock(now: now)
        let dependencies = makeDependencies(secureStore: store, clock: clock)
        try await dependencies.sessionStore.save(makeTokens(now: now, refreshValidFor: 60), userID: "user-1")
        clock.advance(by: 120)

        let model = RootViewModel(dependencies: dependencies)
        await model.restore()

        #expect(!model.isSignedIn)
    }

    @Test("session expiry (refresh token rejected) signs the user out")
    func sessionExpiry() async throws {
        let store = try await signedInStore()
        let model = RootViewModel(dependencies: makeDependencies(secureStore: store))
        await model.restore()

        model.handle(.expired)

        #expect(!model.isSignedIn)
    }

    @Test("connectivity updates are reflected in isOnline")
    func connectivity() async {
        let model = RootViewModel(dependencies: makeDependencies(connectivity: [true, false]))

        await model.observeConnectivity()

        #expect(!model.isOnline)
    }

    @Test("sign out clears the session and the stored tokens")
    func signOut() async throws {
        let store = try await signedInStore()
        let dependencies = makeDependencies(secureStore: store)
        let model = RootViewModel(dependencies: dependencies)
        await model.restore()

        await model.signOut()

        #expect(!model.isSignedIn)
        #expect(await dependencies.sessionStore.currentSession() == nil)
    }

    // MARK: app lock

    @Test("the lock is off by default and never covers the UI")
    func lockOffByDefault() async throws {
        let store = try await signedInStore()
        let model = RootViewModel(dependencies: makeDependencies(secureStore: store))
        await model.restore()

        model.handleScenePhase(.background)

        #expect(!model.isLocked)
        #expect(!model.showsLockScreen)
    }

    @Test("with the lock on, a signed-in app starts locked and unlocks after biometrics succeed")
    func lockAndUnlock() async throws {
        let store = try await signedInStore()
        let biometrics = StubBiometrics(result: true)
        let model = RootViewModel(dependencies: makeDependencies(secureStore: store, biometrics: biometrics))
        await model.setAppLock(enabled: true)
        await model.restore()
        #expect(model.isLocked)

        await model.unlock()

        #expect(!model.isLocked)
    }

    @Test("a failed biometric keeps the app locked")
    func failedUnlockStaysLocked() async throws {
        let store = try await signedInStore()
        let biometrics = StubBiometrics(result: true)
        let model = RootViewModel(dependencies: makeDependencies(secureStore: store, biometrics: biometrics))
        await model.setAppLock(enabled: true)
        await model.restore()

        biometrics.setResult(false)
        await model.unlock()

        #expect(model.isLocked)
    }

    @Test("backgrounding obscures immediately and locks; foregrounding removes only the obscuring")
    func scenePhases() async throws {
        let store = try await signedInStore()
        let model = RootViewModel(dependencies: makeDependencies(secureStore: store))
        await model.setAppLock(enabled: true)
        await model.restore()
        await model.unlock()

        model.handleScenePhase(.inactive)
        #expect(model.isObscured)
        #expect(!model.isLocked)

        model.handleScenePhase(.background)
        #expect(model.isLocked)

        model.handleScenePhase(.active)
        #expect(!model.isObscured)
        #expect(model.isLocked) // still needs an unlock
    }

    @Test("enabling the lock requires a successful authentication (no self lock-out)")
    func enablingNeedsAuthentication() async {
        let biometrics = StubBiometrics(result: false)
        let model = RootViewModel(dependencies: makeDependencies(biometrics: biometrics))

        await model.setAppLock(enabled: true)

        #expect(!model.isAppLockEnabled)
        #expect(biometrics.authenticateCallCount == 1)
    }

    @Test("the lock is never applied when the device cannot authenticate")
    func noBiometricsNoLock() async throws {
        let store = try await signedInStore()
        let biometrics = StubBiometrics(isAvailable: false)
        let model = RootViewModel(dependencies: makeDependencies(secureStore: store, biometrics: biometrics))
        await model.restore()

        model.handleScenePhase(.background)

        #expect(!model.isLocked)
        #expect(!model.canOfferAppLock)
    }
}
