import AedstCore
import AedstNetwork
import Foundation

/// `TaskRepository` over the generated `TasksService` Connect client — the only
/// file in this feature that names a generated `Aedst_Tasks_V1_*` type. Every
/// call uses the authenticated client and goes through
/// `AuthorizedRequestExecutor` (refresh-and-retry once on 401).
///
/// Generated names follow protoc-gen-swift / protoc-gen-connect-swift
/// conventions; the first `make generate` + build is their acceptance test.
public struct ConnectTaskRepository: TaskRepository {
    private let client: Aedst_Tasks_V1_TasksServiceClient
    private let executor: AuthorizedRequestExecutor

    /// `client` must be the authenticated `ProtocolClient`.
    public init(client: ProtocolClient, executor: AuthorizedRequestExecutor) {
        self.client = Aedst_Tasks_V1_TasksServiceClient(client: client)
        self.executor = executor
    }

    public func list(search: String, pageToken: String?) async -> Outcome<Page<TaskItem>> {
        var request = Aedst_Tasks_V1_ListTasksRequest()
        request.search = search
        request.pageSize = 20
        request.pageToken = pageToken ?? ""
        request.sortBy = .createdAt
        request.sortDirection = .desc
        let client = self.client
        let response = await executor.executeUnary { await client.listTasks(request: request, headers: [:]) }
        return response.result
            .map { Page(items: $0.tasks.map(TaskItem.init), nextPageToken: $0.nextPageToken) }
            .mapError { NetworkErrorMapping.map($0) }
    }

    public func get(id: String) async -> Outcome<TaskItem> {
        var request = Aedst_Tasks_V1_GetTaskRequest()
        request.id = id
        let client = self.client
        let response = await executor.executeUnary { await client.getTask(request: request, headers: [:]) }
        return Self.task(from: response.result.map(\.task), present: response.message?.hasTask ?? false)
    }

    public func create(_ task: NewTask, idempotencyKey: String?) async -> Outcome<TaskItem> {
        var request = Aedst_Tasks_V1_CreateTaskRequest()
        request.title = task.title
        request.description_p = task.details
        request.priority = task.priority.proto
        if let dueDate = task.dueDate {
            request.dueDate = Google_Protobuf_Timestamp(date: dueDate)
        }
        let client = self.client
        let headers = IdempotencyKey.headers(for: idempotencyKey)
        let response = await executor.executeUnary { await client.createTask(request: request, headers: headers) }
        return Self.task(from: response.result.map(\.task), present: response.message?.hasTask ?? false)
    }

    public func complete(id: String) async -> Outcome<TaskItem> {
        var request = Aedst_Tasks_V1_CompleteTaskRequest()
        request.id = id
        let client = self.client
        let response = await executor.executeUnary { await client.completeTask(request: request, headers: [:]) }
        return Self.task(from: response.result.map(\.task), present: response.message?.hasTask ?? false)
    }

    public func reopen(id: String) async -> Outcome<TaskItem> {
        var request = Aedst_Tasks_V1_ReopenTaskRequest()
        request.id = id
        let client = self.client
        let response = await executor.executeUnary { await client.reopenTask(request: request, headers: [:]) }
        return Self.task(from: response.result.map(\.task), present: response.message?.hasTask ?? false)
    }

    public func delete(id: String, idempotencyKey: String?) async -> Outcome<Void> {
        var request = Aedst_Tasks_V1_DeleteTaskRequest()
        request.id = id
        let client = self.client
        let headers = IdempotencyKey.headers(for: idempotencyKey)
        let response = await executor.executeUnary { await client.deleteTask(request: request, headers: headers) }
        return response.result.map { _ in () }.mapError { NetworkErrorMapping.map($0) }
    }

    private static func task(
        from result: Result<Aedst_Tasks_V1_Task, ConnectError>,
        present: Bool
    ) -> Outcome<TaskItem> {
        switch result {
        case .success(let task) where present:
            .success(TaskItem(task))
        case .success:
            .failure(.decoding(reason: "Response carried no task"))
        case .failure(let error):
            .failure(NetworkErrorMapping.map(error))
        }
    }
}

extension TaskItem {
    init(_ proto: Aedst_Tasks_V1_Task) {
        self.init(
            id: proto.id,
            title: proto.title,
            details: proto.description_p,
            status: Status(proto.status),
            priority: Priority(proto.priority),
            dueDate: proto.hasDueDate ? proto.dueDate.date : nil,
            createdAt: proto.hasCreatedAt ? proto.createdAt.date : nil,
            completedAt: proto.hasCompletedAt ? proto.completedAt.date : nil,
            version: proto.version
        )
    }
}

extension TaskItem.Status {
    init(_ proto: Aedst_Tasks_V1_TaskStatus) {
        switch proto {
        case .done: self = .done
        case .inProgress: self = .inProgress
        default: self = .todo
        }
    }
}

extension TaskItem.Priority {
    init(_ proto: Aedst_Tasks_V1_TaskPriority) {
        switch proto {
        case .low: self = .low
        case .high: self = .high
        case .urgent: self = .urgent
        default: self = .medium
        }
    }

    var proto: Aedst_Tasks_V1_TaskPriority {
        switch self {
        case .low: .low
        case .medium: .medium
        case .high: .high
        case .urgent: .urgent
        }
    }
}
