import AedstCore
import AedstNetwork
import Foundation

/// The Tasks feature's contribution to the outbox: one handler per queued write type. The composition root
/// passes `make(...)` to the drainer (Android: `@Binds @IntoSet OutboxHandler`). Handlers send the outbox row id
/// as `Idempotency-Key`, so a retry after a lost response cannot apply the write twice.
public enum TaskOutboxHandlers {
    public static func make(client: ProtocolClient, executor: AuthorizedRequestExecutor) -> [any OutboxHandler] {
        let service = Aedst_Tasks_V1_TasksServiceClient(client: client)
        return [
            CreateTaskOutboxHandler(client: service, executor: executor),
            UpdateTaskOutboxHandler(client: service, executor: executor),
        ]
    }
}

struct CreateTaskOutboxHandler: OutboxHandler {
    let type = TaskOutboxQueue.createType
    let client: Aedst_Tasks_V1_TasksServiceClient
    let executor: AuthorizedRequestExecutor

    func deliver(_ item: OutboxItem) async -> Outcome<Void> {
        guard let payload = TaskOutboxPayload.decode(TaskOutboxPayload.Create.self, from: item.payload) else {
            return .failure(.decoding(reason: "task.create payload"))
        }
        var request = Aedst_Tasks_V1_CreateTaskRequest()
        request.title = payload.title
        request.description_p = payload.details
        request.priority = (TaskItem.Priority(wireName: payload.priority) ?? .medium).proto
        if let dueDate = payload.dueDate {
            request.dueDate = Google_Protobuf_Timestamp(date: dueDate)
        }
        let client = self.client
        let headers = IdempotencyKey.header(for: item.id)
        let response = await executor.executeUnary { await client.createTask(request: request, headers: headers) }
        return response.result.map { _ in () }.mapError { NetworkErrorMapping.map($0) }
    }
}

struct UpdateTaskOutboxHandler: OutboxHandler {
    let type = TaskOutboxQueue.updateType
    let client: Aedst_Tasks_V1_TasksServiceClient
    let executor: AuthorizedRequestExecutor

    func deliver(_ item: OutboxItem) async -> Outcome<Void> {
        guard let payload = TaskOutboxPayload.decode(TaskOutboxPayload.Update.self, from: item.payload) else {
            return .failure(.decoding(reason: "task.update payload"))
        }
        var request = Aedst_Tasks_V1_UpdateTaskRequest()
        request.id = payload.id
        // The mask names exactly the fields this queued edit carries (server: tasks/transport/connect.go).
        var mask = Google_Protobuf_FieldMask()
        if let title = payload.title {
            request.title = title
            mask.paths.append("title")
        }
        if let details = payload.details {
            request.description_p = details
            mask.paths.append("description")
        }
        if let priority = payload.priority.flatMap(TaskItem.Priority.init(wireName:)) {
            request.priority = priority.proto
            mask.paths.append("priority")
        }
        request.updateMask = mask
        if let version = payload.expectedVersion {
            request.expectedVersion = version
        }
        let client = self.client
        let headers = IdempotencyKey.header(for: item.id)
        let response = await executor.executeUnary { await client.updateTask(request: request, headers: headers) }
        return response.result.map { _ in () }.mapError { NetworkErrorMapping.map($0) }
    }
}
