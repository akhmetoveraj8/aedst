import AedstAnalytics
import AedstCore
import Foundation
import Testing
@testable import Auth

@Suite("LoginViewModel (browser sign-in)")
@MainActor
struct LoginViewModelTests {
    private func makeViewModel(
        signIn: Outcome<Session>,
        analytics: AnalyticsClient = NoopAnalyticsClient()
    ) -> (LoginViewModel, SpyAuthRepository) {
        let repository = SpyAuthRepository(signInResult: signIn)
        let viewModel = LoginViewModel(
            signInUseCase: SignInUseCase(repository: repository),
            analytics: analytics,
            deviceID: { "device-1" }
        )
        return (viewModel, repository)
    }

    @Test("success returns the session and passes the stable device id")
    func success() async {
        let (viewModel, repository) = makeViewModel(signIn: .success(.stub))

        let session = await viewModel.signIn()

        #expect(session == .stub)
        #expect(viewModel.session == .stub)
        #expect(viewModel.errorMessage == nil)
        #expect(!viewModel.isLoading)
        #expect(await repository.lastSignInDeviceID == "device-1")
    }

    @Test("a dismissed sheet shows no error and records no failure")
    func cancelledIsSilent() async {
        let recorder = RecordingAnalytics()
        let (viewModel, _) = makeViewModel(signIn: .failure(.cancelled), analytics: recorder)

        let session = await viewModel.signIn()

        #expect(session == nil)
        #expect(viewModel.errorMessage == nil)
        #expect(recorder.events.map(\.name) == ["login_cancelled"])
    }

    @Test("a protocol failure shows one generic localized sentence, never the technical reason")
    func failureIsGeneric() async {
        let recorder = RecordingAnalytics()
        let (viewModel, _) = makeViewModel(signIn: .failure(.unauthenticated), analytics: recorder)

        _ = await viewModel.signIn()

        #expect(viewModel.errorMessage?.isEmpty == false)
        #expect(viewModel.errorMessage?.hasPrefix("auth") == false, "missing localization key")
        #expect(recorder.events.map(\.name) == ["login_failure"])
    }

    @Test("a network failure keeps its specific localized text")
    func networkFailure() async {
        let (viewModel, _) = makeViewModel(signIn: .failure(.unavailable(reason: "secret-host")))

        _ = await viewModel.signIn()

        #expect(viewModel.errorMessage == AedstError.unavailable(reason: "").errorDescription)
        #expect(viewModel.errorMessage?.contains("secret-host") == false)
    }

    @Test("analytics receive only the PII-free error category")
    func analyticsAreScrubbed() async {
        let recorder = RecordingAnalytics()
        let (viewModel, _) = makeViewModel(
            signIn: .failure(.unavailable(reason: "user@example.com leaked")),
            analytics: recorder
        )

        await viewModel.signIn()

        #expect(recorder.events.map(\.name) == ["login_failure"])
        #expect(recorder.events.first?.parameters == ["reason": "network"])
    }

    @Test("the use case forwards the device id to the repository")
    func useCase() async {
        let repository = SpyAuthRepository(signInResult: .success(.stub))

        let result = await SignInUseCase(repository: repository)(SignInInput(deviceID: "d-7"))

        #expect(result.value == .stub)
        #expect(await repository.lastSignInDeviceID == "d-7")
    }
}

private final class RecordingAnalytics: AnalyticsClient, @unchecked Sendable {
    private let lock = NSLock()
    private var stored: [AnalyticsEvent] = []
    var events: [AnalyticsEvent] { lock.withLock { stored } }

    func track(_ event: AnalyticsEvent) { lock.withLock { stored.append(event) } }
    func setUserID(_ userID: String?) {}
    func recordError(_ error: Error, context: [String: String]) {}
}
