import AuthenticationServices
import Foundation
#if canImport(UIKit)
import UIKit
#elseif canImport(AppKit)
import AppKit
#endif

/// Runs the identity provider's hosted login in a system browser session and returns the
/// redirect URL. A protocol so `OIDCAuthRepository` is testable without UI.
///
/// The requirement is `@MainActor` because presenting a browser session is UI work.
public protocol WebAuthenticator: Sendable {
    /// Throws `WebAuthenticationError`.
    @MainActor
    func authenticate(url: URL, callbackScheme: String) async throws -> URL
}

public enum WebAuthenticationError: Error, Equatable, Sendable {
    /// The user closed the sheet (`ASWebAuthenticationSessionError.canceledLogin`).
    case cancelled
    case failed(reason: String)
}

/// `ASWebAuthenticationSession` (platform API; AppAuth-iOS is deliberately not adopted).
///
/// - `prefersEphemeralWebBrowserSession = false` by default: the session shares cookies with the system
///   browser, so the IdP's passkeys (WebAuthn runs inside the hosted login, not in this app),
///   saved credentials and existing SSO sessions apply. The system shows its consent prompt
///   ("AEDST wants to use ... to sign in") once per presentation.
/// - `callback: .customScheme`: private-use URI scheme redirect (RFC 8252 section 7.1). Hardening
///   follow-up: iOS 17.4+/macOS 14.4+ `.https(host:path:)` (claimed https redirect) needs an
///   `applinks:` association and an AASA file on a domain we control.
@MainActor
public final class ASWebAuthenticator: NSObject, WebAuthenticator {
    private var session: ASWebAuthenticationSession?
    private let prefersEphemeralSession: Bool

    /// `prefersEphemeralSession`: private browser session (no shared cookies or SSO); see
    /// `OIDCConfiguration.prefersEphemeralBrowserSession`.
    public init(prefersEphemeralSession: Bool = false) {
        self.prefersEphemeralSession = prefersEphemeralSession
        super.init()
    }

    public func authenticate(url: URL, callbackScheme: String) async throws -> URL {
        guard session == nil else {
            throw WebAuthenticationError.failed(reason: "a sign-in session is already running")
        }
        defer { session = nil }

        return try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<URL, any Error>) in
            // @Sendable: the system calls this back on its own schedule; it must not inherit
            // main-actor isolation (that would trap if invoked elsewhere) and touches no state.
            let session = ASWebAuthenticationSession(
                url: url,
                callback: .customScheme(callbackScheme)
            ) { @Sendable callbackURL, error in
                continuation.resume(with: Self.result(callbackURL: callbackURL, error: error))
            }
            session.presentationContextProvider = self
            session.prefersEphemeralWebBrowserSession = prefersEphemeralSession
            self.session = session
            if !session.start() {
                self.session = nil
                continuation.resume(throwing: WebAuthenticationError.failed(reason: "the session could not start"))
            }
        }
    }

    nonisolated private static func result(callbackURL: URL?, error: (any Error)?) -> Result<URL, any Error> {
        if let error {
            if let sessionError = error as? ASWebAuthenticationSessionError, sessionError.code == .canceledLogin {
                return .failure(WebAuthenticationError.cancelled)
            }
            return .failure(WebAuthenticationError.failed(reason: String(describing: error)))
        }
        guard let callbackURL else {
            return .failure(WebAuthenticationError.failed(reason: "no callback URL"))
        }
        return .success(callbackURL)
    }
}

extension ASWebAuthenticator: ASWebAuthenticationPresentationContextProviding {
    public func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
        #if canImport(UIKit)
        let windows = UIApplication.shared.connectedScenes
            .compactMap { $0 as? UIWindowScene }
            .flatMap(\.windows)
        return windows.first(where: \.isKeyWindow) ?? windows.first ?? ASPresentationAnchor()
        #else
        return NSApplication.shared.keyWindow
            ?? NSApplication.shared.mainWindow
            ?? NSApplication.shared.windows.first
            ?? ASPresentationAnchor()
        #endif
    }
}
