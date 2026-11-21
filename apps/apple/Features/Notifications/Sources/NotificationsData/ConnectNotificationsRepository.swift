import AedstCore
import AedstNetwork
import Foundation

/// `NotificationsRepository` over the generated `NotificationsService` client
/// (the only file naming `Aedst_Notifications_V1_*` types).
public struct ConnectNotificationsRepository: NotificationsRepository {
    private let client: Aedst_Notifications_V1_NotificationsServiceClient
    private let executor: AuthorizedRequestExecutor

    /// `client` must be the authenticated `ProtocolClient`.
    public init(client: ProtocolClient, executor: AuthorizedRequestExecutor) {
        self.client = Aedst_Notifications_V1_NotificationsServiceClient(client: client)
        self.executor = executor
    }

    public func list(unreadOnly: Bool, pageToken: String?) async -> Outcome<Page<InboxNotification>> {
        var request = Aedst_Notifications_V1_ListNotificationsRequest()
        request.unreadOnly = unreadOnly
        request.pageSize = 30
        request.pageToken = pageToken ?? ""
        let client = self.client
        let response = await executor.executeUnary { await client.listNotifications(request: request, headers: [:]) }
        return response.result
            .map { Page(items: $0.notifications.map(InboxNotification.init), nextPageToken: $0.nextPageToken) }
            .mapError { NetworkErrorMapping.map($0) }
    }

    public func unreadCount() async -> Outcome<Int> {
        let client = self.client
        let request = Aedst_Notifications_V1_GetUnreadCountRequest()
        let response = await executor.executeUnary { await client.getUnreadCount(request: request, headers: [:]) }
        return response.result.map { Int($0.unread) }.mapError { NetworkErrorMapping.map($0) }
    }

    public func markRead(ids: [String]) async -> Outcome<Void> {
        var request = Aedst_Notifications_V1_MarkReadRequest()
        request.ids = Array(ids.prefix(100)) // proto: max_items 100
        let client = self.client
        let response = await executor.executeUnary { await client.markRead(request: request, headers: [:]) }
        return response.result.map { _ in () }.mapError { NetworkErrorMapping.map($0) }
    }

    public func markAllRead() async -> Outcome<Int> {
        let client = self.client
        let request = Aedst_Notifications_V1_MarkAllReadRequest()
        let response = await executor.executeUnary { await client.markAllRead(request: request, headers: [:]) }
        return response.result.map { Int($0.marked) }.mapError { NetworkErrorMapping.map($0) }
    }

    public func preferences() async -> Outcome<NotificationPreferences> {
        let client = self.client
        let request = Aedst_Notifications_V1_GetPreferencesRequest()
        let response = await executor.executeUnary { await client.getPreferences(request: request, headers: [:]) }
        return response.result.map { NotificationPreferences($0.preferences) }.mapError { NetworkErrorMapping.map($0) }
    }

    public func updatePreferences(_ preferences: NotificationPreferences) async -> Outcome<NotificationPreferences> {
        var request = Aedst_Notifications_V1_UpdatePreferencesRequest()
        request.preferences = preferences.proto
        let client = self.client
        let response = await executor.executeUnary { await client.updatePreferences(request: request, headers: [:]) }
        return response.result.map { NotificationPreferences($0.preferences) }.mapError { NetworkErrorMapping.map($0) }
    }

    public func registerPushDevice(_ registration: APNsRegistration) async -> Outcome<String> {
        var request = Aedst_Notifications_V1_RegisterPushDeviceRequest()
        request.platform = .apns
        request.token = registration.token
        request.apnsTopic = registration.topic
        request.apnsSandbox = registration.isSandbox
        request.deviceName = String(registration.deviceName.prefix(120))
        request.locale = String(registration.locale.prefix(35))
        let client = self.client
        let response = await executor.executeUnary { await client.registerPushDevice(request: request, headers: [:]) }
        return response.result.map(\.deviceID).mapError { NetworkErrorMapping.map($0) }
    }

    public func unregisterPushDevice(deviceID: String) async -> Outcome<Void> {
        var request = Aedst_Notifications_V1_UnregisterPushDeviceRequest()
        request.deviceID = deviceID
        let client = self.client
        let response = await executor.executeUnary { await client.unregisterPushDevice(request: request, headers: [:]) }
        return response.result.map { _ in () }.mapError { NetworkErrorMapping.map($0) }
    }
}

extension InboxNotification {
    init(_ proto: Aedst_Notifications_V1_Notification) {
        let kind: Kind
        switch proto.kind {
        case .taskCompleted: kind = .taskCompleted
        case .taskDueSoon: kind = .taskDueSoon
        case .mediaReady: kind = .mediaReady
        case .system: kind = .system
        default: kind = .other
        }
        self.init(
            id: proto.id,
            kind: kind,
            title: proto.title,
            body: proto.body,
            link: proto.link,
            createdAt: proto.hasCreatedAt ? proto.createdAt.date : nil,
            isRead: proto.hasReadAt
        )
    }
}

extension NotificationPreferences {
    init(_ proto: Aedst_Notifications_V1_Preferences) {
        self.init(
            pushEnabled: proto.pushEnabled,
            taskCompleted: proto.taskCompleted,
            taskDueSoon: proto.taskDueSoon,
            mediaReady: proto.mediaReady
        )
    }

    var proto: Aedst_Notifications_V1_Preferences {
        var proto = Aedst_Notifications_V1_Preferences()
        proto.pushEnabled = pushEnabled
        proto.taskCompleted = taskCompleted
        proto.taskDueSoon = taskDueSoon
        proto.mediaReady = mediaReady
        return proto
    }
}
