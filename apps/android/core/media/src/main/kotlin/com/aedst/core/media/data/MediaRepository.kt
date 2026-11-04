package com.aedst.core.media.data

import com.aedst.core.common.Outcome
import com.aedst.core.media.MediaItem
import com.aedst.core.media.MediaPage

/** The caller's media (MediaService). Every call is scoped to the signed-in user by the server. */
interface MediaRepository {
    suspend fun list(taskId: String? = null, pageToken: String? = null): Outcome<MediaPage>

    suspend fun get(id: String): Outcome<MediaItem>

    suspend fun delete(id: String): Outcome<Unit>
}

/** Result of `CreateUpload`: where and how to PUT the bytes. */
data class UploadTarget(
    val mediaId: String,
    val url: String,
    val method: String,
    val headers: Map<String, String>,
    val expiresAtEpochMs: Long,
)

/** Upload-pipeline half of MediaService, used only by the upload workers. */
interface MediaUploadApi {
    suspend fun createUpload(
        filename: String,
        contentType: String,
        sizeBytes: Long,
        taskId: String?,
        sha256Hex: String?,
    ): UploadTarget

    suspend fun completeUpload(mediaId: String): MediaItem
}
