package com.aedst.core.media.upload

import android.content.Context
import android.net.Uri
import android.provider.OpenableColumns
import androidx.hilt.work.HiltWorker
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters
import androidx.work.workDataOf
import com.aedst.core.common.AedstError
import com.aedst.core.common.DispatcherProvider
import com.aedst.core.media.data.MediaUploadApi
import com.aedst.core.media.processing.ImageCompressor
import com.aedst.core.media.processing.VideoCompressor
import com.aedst.core.network.toAedstError
import dagger.assisted.Assisted
import dagger.assisted.AssistedInject
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.withContext
import okio.HashingSource
import okio.blackholeSink
import okio.buffer
import okio.source
import java.io.File

/**
 * Step 1/3: copy the picked item into app storage, compressing images (ImageCompressor) and videos
 * (VideoCompressor), hash it, and call `CreateUpload` for a presigned URL. Outputs everything the next steps need.
 *
 * The staged file lives in `filesDir/media-uploads/` (not the cache dir) so the OS cannot evict it between steps (see
 * [UploadStaging]); [CompleteUploadWorker] deletes it on success, and so does every other way this upload can end:
 * a terminal failure of any step, a cancel, the start-up sweep and sign-out.
 */
@HiltWorker
class PrepareUploadWorker @AssistedInject constructor(
    @Assisted appContext: Context,
    @Assisted params: WorkerParameters,
    private val uploadApi: MediaUploadApi,
    private val imageCompressor: ImageCompressor,
    private val videoCompressor: VideoCompressor,
    private val dispatchers: DispatcherProvider,
    private val staging: UploadStaging,
) : CoroutineWorker(appContext, params) {

    override suspend fun doWork(): Result {
        val uploadId = inputData.getString(UploadWorkData.KEY_UPLOAD_ID) ?: return Result.failure()
        val source = inputData.getString(UploadWorkData.KEY_SOURCE_URI)?.let(Uri::parse) ?: return Result.failure()
        val taskId = inputData.getString(UploadWorkData.KEY_TASK_ID)

        return try {
            val staged = stage(uploadId, source)
            val target = uploadApi.createUpload(
                filename = staged.filename,
                contentType = staged.contentType,
                sizeBytes = staged.file.length(),
                taskId = taskId,
                sha256Hex = sha256Hex(staged.file),
            )
            Result.success(
                workDataOf(
                    UploadWorkData.KEY_UPLOAD_ID to uploadId,
                    UploadWorkData.KEY_FILE_PATH to staged.file.absolutePath,
                    UploadWorkData.KEY_CONTENT_TYPE to staged.contentType,
                    UploadWorkData.KEY_MEDIA_ID to target.mediaId,
                    UploadWorkData.KEY_UPLOAD_URL to target.url,
                    UploadWorkData.KEY_UPLOAD_METHOD to target.method,
                    UploadWorkData.KEY_UPLOAD_HEADERS to UploadWorkData.encodeHeaders(target.headers),
                    UploadWorkData.KEY_UPLOAD_EXPIRES_AT to target.expiresAtEpochMs,
                ),
            )
        } catch (cancellation: CancellationException) {
            throw cancellation
        } catch (security: SecurityException) {
            // Picker grant lost (e.g. after a reboot without a persisted grant): not retryable.
            failed(uploadId, AedstError.InvalidInput(security.javaClass.simpleName))
        } catch (@Suppress("TooGenericExceptionCaught") throwable: Throwable) {
            failed(uploadId, throwable.toAedstError())
        } finally {
            // Only an app-initiated cancel (the user, sign-out) ends the upload; a constraint stop is retried later.
            if (wasCancelledByApp) discard(uploadId)
        }
    }

    /** A retryable error keeps the staged copy for the next attempt; a terminal one removes it. */
    private suspend fun failed(uploadId: String, error: AedstError): Result {
        if (!UploadWorkData.willRetry(error, runAttemptCount)) discard(uploadId)
        return UploadWorkData.resultFor(error, runAttemptCount)
    }

    private suspend fun discard(uploadId: String) = withContext(NonCancellable + dispatchers.io) {
        staging.delete(uploadId)
    }

    private data class Staged(val file: File, val contentType: String, val filename: String)

    private suspend fun stage(uploadId: String, source: Uri): Staged {
        val resolver = applicationContext.contentResolver
        val mimeType = resolver.getType(source) ?: DEFAULT_CONTENT_TYPE
        val displayName = displayName(source) ?: uploadId
        val baseName = displayName.substringBeforeLast('.')
        val destination = staging.stem(uploadId)

        return when {
            mimeType.startsWith("image/") && mimeType !in PASSTHROUGH_IMAGE_TYPES -> withContext(dispatchers.default) {
                val result = imageCompressor.compress(resolver, source, destination)
                Staged(result.file, result.contentType, baseName + result.extension)
            }
            mimeType.startsWith("video/") -> {
                val file = File(destination.path + VideoCompressor.EXTENSION)
                videoCompressor.compress(source, file)
                Staged(file, VideoCompressor.CONTENT_TYPE, baseName + VideoCompressor.EXTENSION)
            }
            else -> withContext(dispatchers.io) {
                val file = File(destination.path + "." + displayName.substringAfterLast('.', "bin"))
                requireNotNull(resolver.openInputStream(source)).use { input ->
                    file.outputStream().use { input.copyTo(it) }
                }
                Staged(file, mimeType, displayName)
            }
        }
    }

    private fun displayName(source: Uri): String? = applicationContext.contentResolver
        .query(source, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)
        ?.use { cursor -> if (cursor.moveToFirst()) cursor.getString(0) else null }
        ?.takeIf(String::isNotBlank)

    // okio HashingSource streams the file through SHA-256; no hand-written read loop.
    private suspend fun sha256Hex(file: File): String = withContext(dispatchers.io) {
        HashingSource.sha256(file.source()).use { hashing ->
            hashing.buffer().readAll(blackholeSink())
            hashing.hash.hex()
        }
    }

    companion object {
        private const val DEFAULT_CONTENT_TYPE = "application/octet-stream"

        /** Animated or vector formats: re-encoding would drop animation/quality; let the server make variants. */
        private val PASSTHROUGH_IMAGE_TYPES = setOf("image/gif", "image/svg+xml")
    }
}
