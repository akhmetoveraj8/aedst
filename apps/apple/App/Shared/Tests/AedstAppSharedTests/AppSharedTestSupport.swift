import AedstCore
import AedstNetwork
import AedstPersistence
import AedstTesting
import Foundation
@testable import AedstAppShared

/// Biometric double: availability and the result of `authenticate` are scripted.
final class StubBiometrics: BiometricAuthenticating, @unchecked Sendable {
    let isAvailable: Bool
    private let lock = NSLock()
    private var result: Bool
    private var count = 0

    init(isAvailable: Bool = true, result: Bool = true) {
        self.isAvailable = isAvailable
        self.result = result
    }

    var authenticateCallCount: Int { lock.withLock { count } }

    func setResult(_ value: Bool) { lock.withLock { result = value } }

    func authenticate(reason: String) async -> Bool {
        lock.withLock {
            count += 1
            return result
        }
    }
}

@MainActor
func makeDependencies(
    secureStore: InMemorySecureStore = InMemorySecureStore(),
    connectivity: [Bool] = [true],
    biometrics: StubBiometrics = StubBiometrics(),
    clock: ManualClock = ManualClock(now: Date(timeIntervalSince1970: 1_000_000))
) -> AppDependencies {
    AppDependencies(
        environment: .local,
        secureStore: secureStore,
        clock: clock,
        connectivity: StubConnectivity(connectivity),
        biometrics: biometrics,
        outboxStorage: .memory
    )
}

func makeTokens(now: Date, refreshValidFor: TimeInterval = 86_400) -> TokenPair {
    TokenPair(
        accessToken: "access",
        refreshToken: "refresh",
        accessTokenExpiresAt: now.addingTimeInterval(900),
        refreshTokenExpiresAt: now.addingTimeInterval(refreshValidFor)
    )
}
