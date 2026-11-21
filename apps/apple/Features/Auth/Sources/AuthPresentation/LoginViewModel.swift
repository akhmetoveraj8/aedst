import AedstAnalytics
import AedstCore
import AuthDomain
import Foundation
import Observation

@MainActor
@Observable
public final class LoginViewModel {
    public private(set) var isLoading = false
    public private(set) var errorMessage: String?
    public private(set) var session: Session?

    private let signInUseCase: SignInUseCase
    private let analytics: AnalyticsClient
    private let deviceID: @Sendable () -> String
    private let logger = AedstLogger(category: "login")

    /// `deviceID` is injected (the composition root supplies the persisted,
    /// stable per-install identifier) — a view model must not mint a fresh
    /// random one per attempt.
    public init(
        signInUseCase: SignInUseCase,
        analytics: AnalyticsClient = NoopAnalyticsClient(),
        deviceID: @escaping @Sendable () -> String
    ) {
        self.signInUseCase = signInUseCase
        self.analytics = analytics
        self.deviceID = deviceID
    }

    /// Browser sign-in (Authorization Code + PKCE). A dismissed sheet is not an error: no message,
    /// no failure analytics, `nil` returned. Returns the new session on success so callers never
    /// have to read observable state outside SwiftUI's tracking scope.
    @discardableResult
    public func signIn() async -> Session? {
        guard !isLoading else { return nil }
        isLoading = true
        errorMessage = nil
        defer { isLoading = false }

        switch await signInUseCase(SignInInput(deviceID: deviceID())) {
        case .success(let session):
            self.session = session
            analytics.track(AnalyticsEvent(name: "login_success"))
            return session
        case .failure(.cancelled):
            analytics.track(AnalyticsEvent(name: "login_cancelled"))
            return nil
        case .failure(let error):
            errorMessage = Self.message(for: error)
            logger.error("Browser sign-in failed (\(error.analyticsCategory))")
            analytics.track(AnalyticsEvent(name: "login_failure", parameters: ["reason": error.analyticsCategory]))
            return nil
        }
    }

    /// There is no "wrong password" here: protocol-level failures (state/nonce mismatch,
    /// rejected code, unreadable response) all read as one generic, localized sentence;
    /// connectivity problems keep their specific text.
    static func message(for error: AedstError) -> String {
        switch error {
        case .unavailable, .offline, .timeout, .rateLimited, .storage:
            error.errorDescription ?? String(localized: "authBrowserSignInFailed", bundle: .module)
        default:
            String(localized: "authBrowserSignInFailed", bundle: .module)
        }
    }
}
