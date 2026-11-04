import AedstCore
import Foundation

/// Queues the last step of an upload (`CompleteUpload`) for durable delivery. Used when the transfer finished
/// while the app was not running (the background session relaunches the process with no caller awaiting), where
/// a fire-and-forget `Task` could be suspended before the call went out, or fail offline and be forgotten.
public struct MediaOutboxQueue: Sendable {
    /// Outbox `type` of a queued upload completion; also the key the handler is registered under.
    public static let completeType = "media.complete"

    private let outbox: any OutboxEnqueuing

    public init(outbox: any OutboxEnqueuing) {
        self.outbox = outbox
    }

    /// The outbox row id for `mediaID`: stable, so the same finished upload reported twice is stored once, and it
    /// doubles as the `Idempotency-Key` of every delivery attempt.
    public static func operationID(forMediaID mediaID: String) -> String {
        "\(completeType):\(mediaID)"
    }

    /// Persists "complete the upload of `mediaID`". An empty id is rejected (nothing to complete).
    public func enqueueComplete(mediaID: String) async -> Outcome<String> {
        guard !mediaID.isEmpty else { return .failure(.invalidInput(fields: ["mediaID"])) }
        do {
            let payload = try JSONEncoder().encode(Payload(mediaID: mediaID))
            let id = try await outbox.enqueue(
                type: Self.completeType,
                payload: String(decoding: payload, as: UTF8.self),
                id: Self.operationID(forMediaID: mediaID)
            )
            return .success(id)
        } catch {
            return .failure(.storage(reason: String(describing: error)))
        }
    }

    /// JSON stored in the outbox row. A persisted format: only add optional fields.
    struct Payload: Codable, Equatable {
        var mediaID: String
    }
}
