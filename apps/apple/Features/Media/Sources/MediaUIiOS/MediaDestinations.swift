import AedstNavigation
import SwiftUI

extension View {
    /// Registers the media destinations on the root stack.
    public func mediaDestinations(
        @ViewBuilder makeLibrary: @escaping () -> some View,
        @ViewBuilder makeDetail: @escaping (String) -> some View
    ) -> some View {
        aedstDestination(for: MediaRoute.self) { route in
            switch route {
            case .library:
                makeLibrary()
            case .detail(let id):
                makeDetail(id)
            }
        }
    }
}
