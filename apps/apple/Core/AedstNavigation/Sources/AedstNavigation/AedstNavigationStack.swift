import SwiftUI

/// The app's one navigation container: a native `NavigationStack` driven by `Router`.
/// Attach each feature's destinations to `root` with `.aedstDestination(for:)`.
public struct AedstNavigationStack<Root: View>: View {
    @Bindable private var router: Router
    private let root: Root

    /// Creates the stack for `router`; `root` is the first screen.
    public init(router: Router, @ViewBuilder root: () -> Root) {
        self.router = router
        self.root = root()
    }

    public var body: some View {
        NavigationStack(path: $router.path) {
            root
        }
    }
}

extension View {
    /// Maps a feature's route type to its destination view, i.e.
    /// `navigationDestination(for:destination:)`. Features call this so route
    /// registration stays behind the navigation package's API.
    public func aedstDestination<Route: AedstRoute>(
        for routeType: Route.Type,
        @ViewBuilder destination: @escaping (Route) -> some View
    ) -> some View {
        navigationDestination(for: routeType, destination: destination)
    }
}
