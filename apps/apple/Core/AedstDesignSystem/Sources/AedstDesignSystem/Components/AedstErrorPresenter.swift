import AedstCore
import SwiftUI

/// How a failure is surfaced to the user. Transient, self-healing failures
/// (offline, rate limited, a concurrent edit that a refresh resolves) are a
/// toast that gets out of the way; anything the user must acknowledge or act
/// on (forbidden, invalid input, unknown) is a modal alert. A cancelled operation is user intent, not a
/// failure: it is silent.
public enum AedstErrorPresentation: Sendable, Equatable {
    /// Auto-dismissing banner (`AedstToastModifier`).
    case toast
    /// Native `.alert` with OK (and Retry when the caller provides one).
    case alert
    /// Nothing is shown (the user cancelled); the binding is cleared so the error does not linger.
    case silent
}

extension AedstError {
    /// The presentation the shared presenter uses for this error.
    public var presentation: AedstErrorPresentation {
        switch self {
        case .unavailable, .rateLimited, .conflict: .toast
        case .unauthenticated, .forbidden, .notFound, .invalidInput, .decoding, .storage, .unsupported, .upgradeRequired, .cancelled, .unknown: .alert
        }
    }
}

/// The one error presenter every screen uses: bind a view model's
/// `AedstError?` and it renders either a toast or an alert, then clears the
/// binding when dismissed. Text always comes from `AedstError.errorDescription`
/// (localized, never the technical reason). Typed `ConnectError`s reach this
/// point already mapped by `AedstNetwork.NetworkErrorMapping`.
public struct AedstErrorPresenter: ViewModifier {
    @Binding private var error: AedstError?
    private let retry: (() -> Void)?

    /// `retry` adds a "Try again" button to alerts.
    public init(error: Binding<AedstError?>, retry: (() -> Void)? = nil) {
        self._error = error
        self.retry = retry
    }

    public func body(content: Content) -> some View {
        let binding = $error
        let toast = Binding<AedstToastData?>(
            get: {
                guard let error = binding.wrappedValue, error.presentation == .toast else { return nil }
                return AedstToastData(
                    title: error.errorDescription ?? AedstStrings.errorTitle,
                    severity: .warning
                )
            },
            set: { newValue in
                if newValue == nil, binding.wrappedValue?.presentation == .toast {
                    binding.wrappedValue = nil
                }
            }
        )
        let isAlertPresented = Binding<Bool>(
            get: { binding.wrappedValue?.presentation == .alert },
            set: { presented in
                if !presented { binding.wrappedValue = nil }
            }
        )
        let alertError = error?.presentation == .alert ? error : nil

        return content
            .onChange(of: error) { _, newValue in
                // A cancellation is user intent: show nothing, just drop it.
                if newValue?.presentation == .silent { binding.wrappedValue = nil }
            }
            .aedstToast(toast)
            .alert(AedstStrings.errorTitle, isPresented: isAlertPresented, presenting: alertError) { _ in
                if let retry {
                    Button(AedstStrings.retry, action: retry)
                }
                Button(AedstStrings.ok, role: .cancel) {}
            } message: { error in
                Text(error.errorDescription ?? AedstStrings.errorTitle)
            }
    }
}

extension View {
    /// Presents `error` as a toast or an alert (see `AedstErrorPresentation`).
    public func aedstErrorPresenter(_ error: Binding<AedstError?>, retry: (() -> Void)? = nil) -> some View {
        modifier(AedstErrorPresenter(error: error, retry: retry))
    }
}
