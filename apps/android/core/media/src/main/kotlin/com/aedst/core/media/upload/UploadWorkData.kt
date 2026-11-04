package com.aedst.core.media.upload

import androidx.work.ListenableWorker
import com.aedst.core.common.AedstError
import com.aedst.core.common.isRetryable
import kotlinx.serialization.builtins.MapSerializer
import kotlinx.serialization.builtins.serializer
import kotlinx.serialization.json.Json

/**
 * Keys shared by the three upload workers. WorkManager passes each worker's output data to the next one in the
 * chain (merged with its own input), and persists it — which is what makes the pipeline resumable: a retry
 * restarts only the failed step, not the whole upload.
 */
internal object UploadWorkData {
    const val KEY_UPLOAD_ID = "upload_id"
    const val KEY_SOURCE_URI = "source_uri"
    const val KEY_TASK_ID = "task_id"
    const val KEY_FILE_PATH = "file_path"
    const val KEY_CONTENT_TYPE = "content_type"
    const val KEY_MEDIA_ID = "media_id"
    const val KEY_UPLOAD_URL = "upload_url"
    const val KEY_UPLOAD_METHOD = "upload_method"
    const val KEY_UPLOAD_HEADERS = "upload_headers"
    const val KEY_UPLOAD_EXPIRES_AT = "upload_expires_at"
    const val KEY_PROGRESS = "progress"
    const val KEY_ERROR = "error"

    /** Give up after this many attempts of one step (WorkManager backs off exponentially in between). */
    const val MAX_ATTEMPTS = 8

    private val headersSerializer = MapSerializer(String.serializer(), String.serializer())

    fun encodeHeaders(headers: Map<String, String>): String = Json.encodeToString(headersSerializer, headers)

    fun decodeHeaders(json: String?): Map<String, String> =
        json?.let { runCatching { Json.decodeFromString(headersSerializer, it) }.getOrNull() }.orEmpty()

    /** Whether a step that failed with [error] on attempt [runAttemptCount] is tried again (else the chain fails). */
    fun willRetry(error: AedstError, runAttemptCount: Int): Boolean =
        error.isRetryable && runAttemptCount + 1 < MAX_ATTEMPTS

    /** Retry retryable errors while attempts remain; otherwise fail the chain with the error *kind* (no PII). */
    fun resultFor(error: AedstError, runAttemptCount: Int): ListenableWorker.Result =
        if (willRetry(error, runAttemptCount)) {
            ListenableWorker.Result.retry()
        } else {
            ListenableWorker.Result.failure(
                androidx.work.workDataOf(KEY_ERROR to (error::class.simpleName ?: "Unknown")),
            )
        }
}
