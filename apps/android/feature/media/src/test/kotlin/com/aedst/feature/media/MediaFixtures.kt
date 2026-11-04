package com.aedst.feature.media

import com.aedst.core.common.AedstError
import com.aedst.core.common.Outcome
import com.aedst.core.media.MediaItem
import com.aedst.core.media.MediaKind
import com.aedst.core.media.MediaPage
import com.aedst.core.media.MediaStatus
import com.aedst.core.media.data.MediaRepository

internal fun mediaItem(
    id: String,
    kind: MediaKind = MediaKind.IMAGE,
    status: MediaStatus = MediaStatus.READY,
    url: String = "https://cdn.example/$id",
) = MediaItem(
    id = id,
    kind = kind,
    status = status,
    filename = "$id.jpg",
    contentType = "image/jpeg",
    sizeBytes = 1_024,
    width = 800,
    height = 600,
    durationMs = 0,
    url = url,
    presetUrls = emptyMap(),
    posterUrl = null,
    taskId = null,
    createdAt = null,
    failureReason = null,
)

/** In-memory [MediaRepository]: pages keyed by page token (`null` is the first page). */
internal class FakeMediaRepository : MediaRepository {
    var pages: Map<String?, MediaPage> = emptyMap()
    var items: Map<String, MediaItem> = emptyMap()
    var failure: AedstError? = null
    var deleteFailure: AedstError? = null

    val listCalls = mutableListOf<String?>()
    val deleted = mutableListOf<String>()

    override suspend fun list(taskId: String?, pageToken: String?): Outcome<MediaPage> {
        listCalls += pageToken
        return failure?.let { Outcome.Failure(it) } ?: Outcome.Success(pages.getValue(pageToken))
    }

    override suspend fun get(id: String): Outcome<MediaItem> =
        failure?.let { Outcome.Failure(it) } ?: items[id]?.let { Outcome.Success(it) }
            ?: Outcome.Failure(AedstError.NotFound())

    override suspend fun delete(id: String): Outcome<Unit> {
        deleted += id
        return deleteFailure?.let { Outcome.Failure(it) } ?: Outcome.Success(Unit)
    }
}
