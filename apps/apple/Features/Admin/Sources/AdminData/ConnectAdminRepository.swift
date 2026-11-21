import AdminDomain
import AedstCore
import AedstNetwork
import Foundation

/// `AdminRepository` over the generated `AdminService` client (the only file
/// naming `Aedst_Admin_V1_*` types).
public struct ConnectAdminRepository: AdminRepository {
    private let client: Aedst_Admin_V1_AdminServiceClient
    private let executor: AuthorizedRequestExecutor

    /// `client` must be the authenticated `ProtocolClient`.
    public init(client: ProtocolClient, executor: AuthorizedRequestExecutor) {
        self.client = Aedst_Admin_V1_AdminServiceClient(client: client)
        self.executor = executor
    }

    public func overview() async -> Outcome<AdminOverview> {
        let client = self.client
        let request = Aedst_Admin_V1_GetOverviewRequest()
        let response = await executor.executeUnary { await client.getOverview(request: request, headers: [:]) }
        return response.result.map { message in
            AdminOverview(
                tasksTotal: message.tasksTotal,
                tasksDone: message.tasksDone,
                tasksOverdue: message.tasksOverdue,
                mediaTotal: message.mediaTotal,
                mediaBytes: message.mediaBytes,
                pushDevices: message.pushDevices,
                outboxLagSeconds: message.outboxLagSeconds,
                jobsPending: message.jobsPending
            )
        }
        .mapError { NetworkErrorMapping.map($0) }
    }

    public func tasks(query: String, pageToken: String?) async -> Outcome<Page<AdminTask>> {
        var request = Aedst_Admin_V1_ListTasksRequest()
        request.query = query
        request.pageSize = 50
        request.pageToken = pageToken ?? ""
        let client = self.client
        let response = await executor.executeUnary { await client.listTasks(request: request, headers: [:]) }
        return response.result.map { message in
            Page(
                items: message.tasks.map {
                    AdminTask(
                        id: $0.id,
                        ownerID: $0.ownerID,
                        title: $0.title,
                        status: $0.status,
                        createdAt: $0.hasCreatedAt ? $0.createdAt.date : nil
                    )
                },
                nextPageToken: message.nextPageToken
            )
        }
        .mapError { NetworkErrorMapping.map($0) }
    }

    public func deleteTask(id: String, reason: String) async -> Outcome<Void> {
        var request = Aedst_Admin_V1_DeleteTaskRequest()
        request.id = id
        request.reason = reason
        let client = self.client
        let response = await executor.executeUnary { await client.deleteTask(request: request, headers: [:]) }
        return response.result.map { _ in () }.mapError { NetworkErrorMapping.map($0) }
    }

    public func broadcast(_ broadcast: Broadcast) async -> Outcome<Int64> {
        var request = Aedst_Admin_V1_BroadcastNotificationRequest()
        request.userID = broadcast.userID
        request.title = broadcast.title
        request.body = broadcast.body
        request.link = broadcast.link
        let client = self.client
        let response = await executor.executeUnary { await client.broadcastNotification(request: request, headers: [:]) }
        return response.result.map(\.recipients).mapError { NetworkErrorMapping.map($0) }
    }

    public func auditLog(pageToken: String?) async -> Outcome<Page<AuditEntry>> {
        var request = Aedst_Admin_V1_ListAuditLogRequest()
        request.pageSize = 50
        request.pageToken = pageToken ?? ""
        let client = self.client
        let response = await executor.executeUnary { await client.listAuditLog(request: request, headers: [:]) }
        return response.result.map { message in
            Page(
                items: message.entries.map {
                    AuditEntry(
                        id: $0.id,
                        actorID: $0.actorID,
                        action: $0.action,
                        targetKind: $0.targetKind,
                        targetID: $0.targetID,
                        reason: $0.reason,
                        createdAt: $0.hasCreatedAt ? $0.createdAt.date : nil
                    )
                },
                nextPageToken: message.nextPageToken
            )
        }
        .mapError { NetworkErrorMapping.map($0) }
    }
}
