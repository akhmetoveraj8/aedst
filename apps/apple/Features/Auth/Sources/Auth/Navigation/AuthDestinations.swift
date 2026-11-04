import AedstNavigation
import SwiftUI

/// `App/Shared`'s composition root attaches this to the root `AedstNavigationStack`
/// alongside every other feature's `*Destinations` modifier — the one place
/// that is allowed to know every feature exists (see `docs/architecture-apple.md`).
public struct AuthDestinations: ViewModifier {
    private let makeLoginView: () -> LoginView

    public init(makeLoginView: @escaping () -> LoginView) {
        self.makeLoginView = makeLoginView
    }

    public func body(content: Content) -> some View {
        content.aedstDestination(for: AuthRoute.self) { route in
            switch route {
            case .login:
                makeLoginView()
            }
        }
    }
}

extension View {
    public func authDestinations(makeLoginView: @escaping () -> LoginView) -> some View {
        modifier(AuthDestinations(makeLoginView: makeLoginView))
    }
}
