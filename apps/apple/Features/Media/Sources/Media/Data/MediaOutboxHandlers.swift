import AedstCore
import AedstNetwork
import Foundation

/// The Media feature's contribution to the outbox (see `TaskOutboxHandlers`): delivers a queued `CompleteUpload`
/// with the row id as `Idempotency-Key`.
public enum MediaOutboxHandlers {
    public static func make(client: ProtocolClient, executor: AuthorizedRequestExecutor) -> [any OutboxHandler] {
        [CompleteUploadOutboxHandler(repository: ConnectMediaRepository(client: client, executor: executor))]
    }
}

struct CompleteUploadOutboxHandler: OutboxHandler {
    let type = MediaOutboxQueue.completeType
    let repository: any CompleteUploadDelivering

    func deliver(_ item: OutboxItem) async -> Outcome<Void> {
        guard let data = item.payload.data(using: .utf8),
              let payload = try? JSONDecoder().decode(MediaOutboxQueue.Payload.self, from: data),
              !payload.mediaID.isEmpty
        else {
            return .failure(.decoding(reason: "media.complete payload"))
        }
        return await repository.completeUpload(id: payload.mediaID, idempotencyKey: item.id).map { _ in () }
    }
}

/// The one call the handler needs; `ConnectMediaRepository` implements it, tests stub it.
protocol CompleteUploadDelivering: Sendable {
    func completeUpload(id: String, idempotencyKey: String?) async -> Outcome<MediaItem>
}

extension ConnectMediaRepository: CompleteUploadDelivering {}
