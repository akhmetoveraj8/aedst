#if os(iOS)
import AedstDesignSystem
import AuthDomain
import AuthPresentation
import Foundation
import SwiftUI

/// Browser sign-in: one button. The identity provider's hosted page collects credentials,
/// passkeys and MFA, so the app renders no credential fields.
public struct LoginView: View {
    @State private var viewModel: LoginViewModel
    private let onLoginSucceeded: (Session) -> Void

    public init(viewModel: LoginViewModel, onLoginSucceeded: @escaping (Session) -> Void) {
        self._viewModel = State(wrappedValue: viewModel)
        self.onLoginSucceeded = onLoginSucceeded
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: AedstSpacing.lg) {
            Text(String(localized: "authLoginTitle", bundle: AuthStrings.bundle))
                .aedstFont(AedstTypography.largeTitle)
                .foregroundStyle(AedstColor.foreground)
                .accessibilityAddTraits(.isHeader)

            Text(String(localized: "authLoginContinueHint", bundle: AuthStrings.bundle))
                .aedstFont(AedstTypography.caption)
                .foregroundStyle(AedstColor.mutedForeground)

            errorText

            AedstButton(String(localized: "authLoginContinue", bundle: AuthStrings.bundle), isLoading: viewModel.isLoading) {
                signIn()
            }
            .accessibilityHint(Text(String(localized: "authLoginContinueHint", bundle: AuthStrings.bundle)))
            .accessibilityIdentifier("login.continue")

            Spacer()
        }
        .padding(AedstSpacing.xxl)
        .background(AedstColor.background)
        // The inline error appears below the hint; VoiceOver does not read it on its own.
        .onChange(of: viewModel.errorMessage) { previous, current in
            if let text = AedstAnnouncementPolicy.announcement(previous: previous, current: current) {
                AedstAnnouncer.post(text)
            }
        }
    }

    @ViewBuilder
    private var errorText: some View {
        if let errorMessage = viewModel.errorMessage {
            Text(errorMessage)
                .aedstFont(AedstTypography.caption)
                .foregroundStyle(AedstColor.destructive)
                .accessibilityIdentifier("login.error")
        }
    }

    private func signIn() {
        Task {
            if let session = await viewModel.signIn() {
                onLoginSucceeded(session)
            }
        }
    }
}
#endif
