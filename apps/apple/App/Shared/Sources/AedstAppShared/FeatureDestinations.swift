import Admin
import AedstNavigation
import Media
import Notifications
import Search
import SwiftUI
import Tasks

/// Every signed-in feature's destinations, composed in one place. Attached to the root of both layouts (the compact
/// stack and the split view's detail stack), so a route renders the same screen in either.
struct FeatureDestinations: ViewModifier {
    let dependencies: AppDependencies
    let router: Router
    let open: (String) -> Void

    func body(content: Content) -> some View {
        content
            .tasksDestinations {
                TaskListView(viewModel: dependencies.makeTaskListViewModel()) { id in
                    router.push(TaskRoute.detail(id: id))
                }
            } makeDetail: { id in
                TaskDetailView(
                    viewModel: dependencies.makeTaskDetailViewModel(id: id),
                    onDeleted: { router.pop() }
                ) { taskID in
                    // Media attachments slot: Tasks never imports Media.
                    TaskAttachmentsView(viewModel: dependencies.makeMediaCollectionViewModel(taskID: taskID)) { mediaID in
                        router.push(MediaRoute.detail(id: mediaID))
                    }
                }
            }
            .searchDestinations {
                SearchView(viewModel: dependencies.makeSearchViewModel(), onOpenLink: open)
            }
            .notificationsDestinations {
                NotificationInboxView(
                    viewModel: dependencies.makeInboxViewModel(),
                    onOpenLink: open,
                    onOpenPreferences: { router.push(NotificationsRoute.preferences) }
                )
            } makePreferences: {
                NotificationPreferencesView(viewModel: dependencies.makeNotificationPreferencesViewModel())
            }
            .mediaDestinations {
                MediaLibraryView(viewModel: dependencies.makeMediaCollectionViewModel(taskID: nil)) { id in
                    router.push(MediaRoute.detail(id: id))
                }
            } makeDetail: { id in
                MediaDetailView(viewModel: dependencies.makeMediaDetailViewModel(id: id)) { router.pop() }
            }
            .adminDestinations { route in
                AdminScreen(route: route, dependencies: dependencies, router: router)
            }
    }
}

/// The admin screens; every view model comes from the composition root's `makeAdmin*ViewModel` factories.
private struct AdminScreen: View {
    let route: AdminRoute
    let dependencies: AppDependencies
    let router: Router

    var body: some View {
        switch route {
        case .dashboard:
            AdminDashboardView(viewModel: dependencies.makeAdminDashboardViewModel()) { router.push($0) }
        case .tasks:
            AdminTasksView(viewModel: dependencies.makeAdminTasksViewModel())
        case .broadcast:
            AdminBroadcastView(viewModel: dependencies.makeAdminBroadcastViewModel())
        case .auditLog:
            AdminAuditLogView(viewModel: dependencies.makeAdminAuditLogViewModel())
        }
    }
}
