package com.aedst.core.media.data

import com.aedst.core.common.Outcome
import com.aedst.core.common.runCatchingOutcome
import com.aedst.core.media.MediaItem
import com.aedst.core.media.MediaPage
import com.aedst.core.network.idempotencyHeaders
import com.aedst.core.network.rpc
import com.aedst.core.network.toInstant
import com.aedst.media.v1.MediaServiceClientInterface
import com.aedst.media.v1.completeUploadRequest
import com.aedst.media.v1.createUploadRequest
import com.aedst.media.v1.deleteMediaRequest
import com.aedst.media.v1.getMediaRequest
import com.aedst.media.v1.listMediaRequest
import javax.inject.Inject

/** MediaService over ConnectRPC. Errors surface as `AedstError` (see `core/network`'s `toAedstError`). */
class ConnectMediaRepository @Inject constructor(private val client: MediaServiceClientInterface) :
    MediaRepository,
    MediaUploadApi {

    override suspend fun list(taskId: String?, pageToken: String?): Outcome<MediaPage> = runCatchingOutcome {
        val response = rpc {
            client.listMedia(
                listMediaRequest {
                    taskId?.let { this.taskId = it }
                    pageToken?.let { this.pageToken = it }
                    pageSize = PAGE_SIZE
                },
            )
        }
        MediaPage(response.mediaList.map { it.toDomain() }, response.nextPageToken.takeIf(String::isNotEmpty))
    }

    override suspend fun get(id: String): Outcome<MediaItem> = runCatchingOutcome {
        rpc { client.getMedia(getMediaRequest { this.id = id }) }.media.toDomain()
    }

    override suspend fun delete(id: String): Outcome<Unit> = runCatchingOutcome {
        rpc { client.deleteMedia(deleteMediaRequest { this.id = id }) }
        Unit
    }

    override suspend fun createUpload(
        filename: String,
        contentType: String,
        sizeBytes: Long,
        taskId: String?,
        sha256Hex: String?,
    ): UploadTarget {
        // A fresh Idempotency-Key per call: OkHttp re-sends a POST whose connection broke, and a lost response must
        // not leave a second pending media row behind.
        val response = rpc {
            client.createUpload(
                createUploadRequest {
                    this.filename = filename
                    this.contentType = contentType
                    this.sizeBytes = sizeBytes
                    taskId?.let { this.taskId = it }
                    sha256Hex?.let { this.sha256 = it }
                },
                idempotencyHeaders(),
            )
        }
        return UploadTarget(
            mediaId = response.media.id,
            url = response.uploadUrl,
            method = response.method.ifEmpty { "PUT" },
            headers = response.headersMap,
            expiresAtEpochMs = if (response.hasExpiresAt()) response.expiresAt.toInstant().toEpochMilli() else 0L,
        )
    }

    override suspend fun completeUpload(mediaId: String): MediaItem =
        rpc { client.completeUpload(completeUploadRequest { id = mediaId }) }.media.toDomain()

    private companion object {
        const val PAGE_SIZE = 50
    }
}
