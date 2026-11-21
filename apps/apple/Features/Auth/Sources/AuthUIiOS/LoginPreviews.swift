#if os(iOS)
#if DEBUG
import AedstCore
import AuthDomain
import AuthPresentation
import SwiftUI

/// Repository for Xcode Previews: sign-in is never reached, the screen only renders. Debug builds only.
private struct PreviewAuthRepository: AuthRepository {
    func signIn(deviceID: String) async -> Outcome<Session> { .failure(.unsupported) }
    func logout() async -> Outcome<Void> { .success(()) }
    func currentSession() async -> Session? { nil }
}

#Preview("Login") {
    LoginView(
        viewModel: LoginViewModel(
            signInUseCase: SignInUseCase(repository: PreviewAuthRepository()),
            deviceID: { "preview-device" }
        )
    ) { _ in }
}
#endif
#endif
