import AedstCore
import Foundation
import Testing
@testable import Media

private actor RecordingOutbox: OutboxEnqueuing {
    private(set) var rows: [(type: String, payload: String, id: String)] = []

    func enqueue(type: String, payload: String, id: String) async throws -> String {
        rows.append((type, payload, id))
        return id
    }
}

private actor RecordingCompleter: CompleteUploadDelivering {
    private(set) var calls: [(id: String, key: String?)] = []
    var result: Outcome<MediaItem> = .failure(.offline)

    func setResult(_ value: Outcome<MediaItem>) { result = value }

    func completeUpload(id: String, idempotencyKey: String?) async -> Outcome<MediaItem> {
        calls.append((id, idempotencyKey))
        return result
    }
}

@Suite("Media outbox (upload completion)")
struct MediaOutboxTests {
    @Test("a finished upload is queued under a stable id derived from the media id")
    func enqueuesStableRow() async throws {
        let outbox = RecordingOutbox()

        let id = try #require(await MediaOutboxQueue(outbox: outbox).enqueueComplete(mediaID: "m-1").value)

        #expect(id == "media.complete:m-1")
        let row = try #require(await outbox.rows.first)
        #expect(row.type == "media.complete")
        #expect(row.payload.contains("\"mediaID\":\"m-1\""))
    }

    @Test("an empty media id is rejected and nothing is queued")
    func rejectsEmptyID() async {
        let outbox = RecordingOutbox()
        let result = await MediaOutboxQueue(outbox: outbox).enqueueComplete(mediaID: "")
        #expect(result.error == .invalidInput(fields: ["mediaID"]))
        #expect(await outbox.rows.isEmpty)
    }

    @Test("the handler completes the upload with the row id as Idempotency-Key")
    func handlerForwardsKey() async throws {
        let completer = RecordingCompleter()
        await completer.setResult(.success(MediaItem(id: "m-1", kind: .image, status: .processing, filename: "a.jpg", contentType: "image/jpeg", sizeBytes: 1)))
        let handler = CompleteUploadOutboxHandler(repository: completer)
        let payload = String(decoding: try JSONEncoder().encode(MediaOutboxQueue.Payload(mediaID: "m-1")), as: UTF8.self)

        let result = await handler.deliver(OutboxItem(id: "media.complete:m-1", type: "media.complete", payload: payload, attempts: 0))

        #expect(result.error == nil)
        let call = try #require(await completer.calls.first)
        #expect(call.id == "m-1")
        #expect(call.key == "media.complete:m-1")
    }

    @Test("a corrupt payload is a permanent decoding failure, not a crash")
    func corruptPayload() async {
        let handler = CompleteUploadOutboxHandler(repository: RecordingCompleter())
        let result = await handler.deliver(OutboxItem(id: "x", type: "media.complete", payload: "{", attempts: 0))
        #expect(result.error == .decoding(reason: "media.complete payload"))
    }
}
