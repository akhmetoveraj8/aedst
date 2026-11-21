import AedstNavigation
import SwiftUI

extension View {
    /// Registers the admin destinations; `makeView` builds each section.
    public func adminDestinations(@ViewBuilder makeView: @escaping (AdminRoute) -> some View) -> some View {
        aedstDestination(for: AdminRoute.self) { route in
            makeView(route)
        }
    }
}
