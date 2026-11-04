import AedstCore
import AedstNetwork
import Foundation

/// `MediaRepository` over the generated `MediaService` client (the only file
/// naming `Aedst_Media_V1_*` types).
public struct ConnectMediaRepository: MediaRepository {
    private let client: Aedst_Media_V1_MediaServiceClient
    private let executor: AuthorizedRequestExecutor

    /// `client` must be the authenticated `ProtocolClient`.
    public init(client: ProtocolClient, executor: AuthorizedRequestExecutor) {
        self.client = Aedst_Media_V1_MediaServiceClient(client: client)
        self.executor = executor
    }

    public func createUpload(_ upload: UploadRequest) async -> Outcome<UploadTicket> {
        var request = Aedst_Media_V1_CreateUploadRequest()
        request.filename = String(upload.filename.prefix(255))
        request.contentType = upload.contentType
        request.sizeBytes = upload.sizeBytes
        request.taskID = upload.taskID ?? ""
        request.sha256 = upload.sha256 ?? ""
        let client = self.client
        let response = await executor.executeUnary { await client.createUpload(request: request, headers: [:]) }
        switch response.result {
        case .success(let message):
            guard message.hasMedia, let url = URL(string: message.uploadURL) else {
                return .failure(.decoding(reason: "CreateUploadResponse without media or upload URL"))
            }
            return .success(
                UploadTicket(media: MediaItem(message.media), uploadURL: url, method: message.method, headers: message.headers)
            )
        case .failure(let error):
            return .failure(NetworkErrorMapping.map(error))
        }
    }

    public func completeUpload(id: String) async -> Outcome<MediaItem> {
        await completeUpload(id: id, idempotencyKey: nil)
    }

    /// `idempotencyKey` is sent as `Idempotency-Key` (the outbox row id when delivered from the outbox).
    public func completeUpload(id: String, idempotencyKey: String?) async -> Outcome<MediaItem> {
        var request = Aedst_Media_V1_CompleteUploadRequest()
        request.id = id
        let client = self.client
        let headers = IdempotencyKey.headers(for: idempotencyKey)
        let response = await executor.executeUnary { await client.completeUpload(request: request, headers: headers) }
        switch response.result {
        case .success(let message):
            // An absent message is a default `Media` with an empty id; never hand that to the UI as an item.
            guard message.hasMedia else { return .failure(.decoding(reason: "CompleteUploadResponse without media")) }
            return .success(MediaItem(message.media))
        case .failure(let error):
            return .failure(NetworkErrorMapping.map(error))
        }
    }

    public func get(id: String) async -> Outcome<MediaItem> {
        var request = Aedst_Media_V1_GetMediaRequest()
        request.id = id
        let client = self.client
        let response = await executor.executeUnary { await client.getMedia(request: request, headers: [:]) }
        switch response.result {
        case .success(let message):
            guard message.hasMedia else { return .failure(.decoding(reason: "GetMediaResponse without media")) }
            return .success(MediaItem(message.media))
        case .failure(let error):
            return .failure(NetworkErrorMapping.map(error))
        }
    }

    public func list(taskID: String?, pageToken: String?) async -> Outcome<Page<MediaItem>> {
        var request = Aedst_Media_V1_ListMediaRequest()
        request.taskID = taskID ?? ""
        request.pageSize = 50
        request.pageToken = pageToken ?? ""
        let client = self.client
        let response = await executor.executeUnary { await client.listMedia(request: request, headers: [:]) }
        return response.result
            .map { Page(items: $0.media.map(MediaItem.init), nextPageToken: $0.nextPageToken) }
            .mapError { NetworkErrorMapping.map($0) }
    }

    public func delete(id: String) async -> Outcome<Void> {
        var request = Aedst_Media_V1_DeleteMediaRequest()
        request.id = id
        let client = self.client
        let response = await executor.executeUnary { await client.deleteMedia(request: request, headers: [:]) }
        return response.result.map { _ in () }.mapError { NetworkErrorMapping.map($0) }
    }
}

extension MediaItem {
    init(_ proto: Aedst_Media_V1_Media) {
        let kind: Kind
        switch proto.kind {
        case .image: kind = .image
        case .video: kind = .video
        case .audio: kind = .audio
        case .document: kind = .document
        default: kind = .other
        }
        let status: Status
        switch proto.status {
        case .pendingUpload: status = .pendingUpload
        case .processing: status = .processing
        case .ready: status = .ready
        case .failed: status = .failed
        default: status = .unknown
        }
        self.init(
            id: proto.id,
            kind: kind,
            status: status,
            filename: proto.filename,
            contentType: proto.contentType,
            sizeBytes: proto.sizeBytes,
            durationMs: proto.durationMs,
            url: proto.url.isEmpty ? nil : URL(string: proto.url),
            variants: proto.variants.compactMap(MediaVariant.init),
            taskID: proto.taskID.isEmpty ? nil : proto.taskID,
            createdAt: proto.hasCreatedAt ? proto.createdAt.date : nil,
            failureReason: proto.failureReason.isEmpty ? nil : proto.failureReason
        )
    }
}

extension MediaVariant {
    init?(_ proto: Aedst_Media_V1_Variant) {
        guard let url = URL(string: proto.url) else { return nil }
        // Matched on the wire number so the mapping does not depend on
        // swift-protobuf's spelling of digit-containing case names.
        let kind: Kind
        switch proto.kind.rawValue {
        case 4: kind = .poster
        case 5: kind = .thumb64
        case 6: kind = .avatar256
        case 7: kind = .card400
        case 8: kind = .feed800x600
        case 9: kind = .story1080x1350
        default: kind = .other
        }
        self.init(kind: kind, url: url, width: Int(proto.width), height: Int(proto.height))
    }
}
