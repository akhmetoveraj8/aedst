import AedstNavigation
import SwiftUI

/// Registers the task destinations on the root stack (composed in `App/Shared`).
public struct TasksDestinations<ListView: View, DetailView: View>: ViewModifier {
    private let makeList: () -> ListView
    private let makeDetail: (String) -> DetailView

    /// Builders for each `TaskRoute` case.
    public init(
        @ViewBuilder makeList: @escaping () -> ListView,
        @ViewBuilder makeDetail: @escaping (String) -> DetailView
    ) {
        self.makeList = makeList
        self.makeDetail = makeDetail
    }

    public func body(content: Content) -> some View {
        content.aedstDestination(for: TaskRoute.self) { route in
            switch route {
            case .list:
                makeList()
            case .detail(let id):
                makeDetail(id)
            }
        }
    }
}

extension View {
    /// Attaches `TasksDestinations`.
    public func tasksDestinations(
        @ViewBuilder makeList: @escaping () -> some View,
        @ViewBuilder makeDetail: @escaping (String) -> some View
    ) -> some View {
        modifier(TasksDestinations(makeList: makeList, makeDetail: makeDetail))
    }
}
