import AdminData
import AdminDomain
import AdminPresentation
import AedstCore
import AedstMedia
import AuthData
import AuthDomain
import AuthPresentation
import Foundation
import MediaData
import MediaDomain
import MediaPresentation
import NotificationsData
import NotificationsDomain
import NotificationsPresentation
import SearchData
import SearchDomain
import SearchPresentation
import TasksData
import TasksDomain
import TasksPresentation

/// One fresh view model per screen, built from the composition root's long-lived pieces.
extension AppDependencies {
    // MARK: Factories (one fresh view model per screen)

    public func makeLoginViewModel() -> LoginViewModel {
        let identifiers = deviceIdentifiers
        return LoginViewModel(
            signInUseCase: SignInUseCase(repository: authRepository),
            analytics: analytics,
            deviceID: { identifiers.deviceID() }
        )
    }

    /// The session's single task list: the list screen and the detail screens' callbacks share it.
    public func makeTaskListViewModel() -> TaskListViewModel {
        sessionModels.taskList {
            TaskListViewModel(repository: taskRepository, analytics: analytics, outbox: taskOutbox, clock: clock)
        }
    }

    /// Reports changes and deletions to the shared list, so it never needs a refetch after the detail screen.
    public func makeTaskDetailViewModel(id: String) -> TaskDetailViewModel {
        let list = makeTaskListViewModel()
        return TaskDetailViewModel(
            taskID: id,
            repository: taskRepository,
            analytics: analytics,
            clock: clock,
            onChange: { list.apply($0) },
            onDelete: { list.remove(id: $0) }
        )
    }

    public func makeSearchViewModel() -> SearchViewModel {
        SearchViewModel(repository: searchRepository, clock: clock, analytics: analytics)
    }

    public func makeInboxViewModel() -> NotificationInboxViewModel {
        NotificationInboxViewModel(repository: notificationsRepository, badge: badge, analytics: analytics)
    }

    public func makeNotificationPreferencesViewModel() -> NotificationPreferencesViewModel {
        NotificationPreferencesViewModel(repository: notificationsRepository, push: push)
    }

    /// `taskID` scopes the collection to one task's attachments.
    public func makeMediaCollectionViewModel(taskID: String?) -> MediaCollectionViewModel {
        MediaCollectionViewModel(taskID: taskID, repository: mediaRepository, uploader: uploader, analytics: analytics)
    }

    public func makeMediaDetailViewModel(id: String) -> MediaDetailViewModel {
        MediaDetailViewModel(mediaID: id, repository: mediaRepository)
    }

    // MARK: Admin (one fresh view model per screen)

    public func makeAdminDashboardViewModel() -> AdminDashboardViewModel {
        AdminDashboardViewModel(repository: adminRepository)
    }

    public func makeAdminTasksViewModel() -> AdminTasksViewModel {
        AdminTasksViewModel(repository: adminRepository, analytics: analytics)
    }

    public func makeAdminBroadcastViewModel() -> AdminBroadcastViewModel {
        AdminBroadcastViewModel(repository: adminRepository)
    }

    public func makeAdminAuditLogViewModel() -> AdminAuditLogViewModel {
        AdminAuditLogViewModel(repository: adminRepository)
    }

    public var logoutUseCase: LogoutUseCase { LogoutUseCase(repository: authRepository) }
    public var restoreSessionUseCase: RestoreSessionUseCase { RestoreSessionUseCase(repository: authRepository) }
}
