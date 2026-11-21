import AedstCore
import AedstTesting
import AuthData
import AuthDomain
import AuthPresentation
import Foundation
import Testing
@testable import AedstAppCore

@Suite("AppDependencies")
@MainActor
struct AppDependenciesTests {
    @Test("builds the whole graph from injected doubles")
    func initializes() {
        let dependencies = makeDependencies()
        _ = dependencies.authRepository
        _ = dependencies.authenticatedClient
        _ = dependencies.authorizedRequests
        _ = dependencies.makeLoginViewModel()
    }

    @Test("every call to makeLoginViewModel returns a fresh view model")
    func freshViewModels() {
        let dependencies = makeDependencies()

        let first = dependencies.makeLoginViewModel()
        let second = dependencies.makeLoginViewModel()

        #expect(first !== second)
        #expect(second.session == nil)
    }

    @Test("an injected OIDC configuration builds the graph with browser sign-in")
    func browserSignInWithOIDC() throws {
        let configuration = try #require(OIDCConfiguration(issuer: "https://idp.example.com", clientID: "client-1"))
        let dependencies = AppDependencies(
            environment: .local,
            secureStore: InMemorySecureStore(),
            clock: ManualClock(now: Date(timeIntervalSince1970: 1_000_000)),
            connectivity: StubConnectivity([true]),
            biometrics: StubBiometrics(),
            oidc: configuration,
            webAuthenticator: UnusedWebAuthenticator(),
            outboxStorage: .memory
        )

        #expect(dependencies.makeLoginViewModel().session == nil)
    }
}

private struct UnusedWebAuthenticator: WebAuthenticator {
    @MainActor
    func authenticate(url: URL, callbackScheme: String) async throws -> URL {
        throw WebAuthenticationError.failed(reason: "not used")
    }
}
