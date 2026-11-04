import AedstNavigation
import SwiftUI

extension View {
    /// Registers the search destination on the root stack.
    public func searchDestinations(@ViewBuilder makeSearch: @escaping () -> some View) -> some View {
        aedstDestination(for: SearchRoute.self) { route in
            switch route {
            case .search:
                makeSearch()
            }
        }
    }
}
