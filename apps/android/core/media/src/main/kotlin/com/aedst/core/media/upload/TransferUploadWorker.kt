package com.aedst.core.media.upload

import android.app.Notification
import android.content.Context
import android.content.pm.ServiceInfo
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.hilt.work.HiltWorker
import androidx.work.CoroutineWorker
import androidx.work.ForegroundInfo
import androidx.work.WorkerParameters
import androidx.work.workDataOf
import com.aedst.core.common.AedstError
import com.aedst.core.common.DispatcherProvider
import com.aedst.core.media.R
import com.aedst.core.network.toAedstError
import dagger.assisted.Assisted
import dagger.assisted.AssistedInject
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.withContext
import java.io.File
import java.time.Clock

/**
 * Step 2/3: PUT the staged file to the presigned URL, publishing progress (`KEY_PROGRESS`, 0..1) for the UI.
 * Runs as a foreground (dataSync) worker when allowed, so a long video upload survives the app going to background.
 *
 * Resumability: S3-style presigned PUTs are not byte-resumable, so a retry re-sends the file — but only this step:
 * the compressed file and the `CreateUpload` result from step 1 are reused. An expired URL fails the chain with
 * `InvalidInput` (the user re-attaches; the server garbage-collects the pending media row).
 */
@HiltWorker
class TransferUploadWorker @AssistedInject constructor(
    @Assisted appContext: Context,
    @Assisted params: WorkerParameters,
    private val uploader: PresignedUploader,
    private val clock: Clock,
    private val staging: UploadStaging,
    private val dispatchers: DispatcherProvider,
) : CoroutineWorker(appContext, params) {

    override suspend fun doWork(): Result {
        val file = inputData.getString(UploadWorkData.KEY_FILE_PATH)?.let(::File)
        val url = inputData.getString(UploadWorkData.KEY_UPLOAD_URL)
        if (file == null || !file.exists() || url.isNullOrEmpty()) {
            return failed(AedstError.InvalidInput("Staged upload missing"))
        }
        val expiresAt = inputData.getLong(UploadWorkData.KEY_UPLOAD_EXPIRES_AT, 0L)
        if (expiresAt in 1..clock.millis()) {
            return failed(AedstError.InvalidInput("Upload URL expired"))
        }

        tryPromoteToForeground()
        return try {
            var lastReported = -1
            uploader.upload(
                file = file,
                target = PresignedTarget(
                    url = url,
                    method = inputData.getString(UploadWorkData.KEY_UPLOAD_METHOD) ?: "PUT",
                    headers = UploadWorkData.decodeHeaders(inputData.getString(UploadWorkData.KEY_UPLOAD_HEADERS)),
                    fallbackContentType = inputData.getString(UploadWorkData.KEY_CONTENT_TYPE) ?: DEFAULT_CONTENT_TYPE,
                ),
            ) { sent, total ->
                val percent = if (total > 0) (sent * PERCENT / total).toInt() else 0
                if (percent != lastReported) {
                    lastReported = percent
                    setProgressAsync(workDataOf(UploadWorkData.KEY_PROGRESS to percent / PERCENT.toFloat()))
                }
            }
            // Pass step 1's outputs through so step 3 sees media id and file path.
            Result.success(inputData)
        } catch (cancellation: CancellationException) {
            throw cancellation
        } catch (@Suppress("TooGenericExceptionCaught") throwable: Throwable) {
            failed(throwable.toAedstError())
        } finally {
            // Only an app-initiated cancel (the user, sign-out) ends the upload; a constraint stop is retried later.
            if (wasCancelledByApp) discard()
        }
    }

    /** A retryable error keeps the staged copy for the next attempt; a terminal one removes it. */
    private suspend fun failed(error: AedstError): Result {
        if (!UploadWorkData.willRetry(error, runAttemptCount)) discard()
        return UploadWorkData.resultFor(error, runAttemptCount)
    }

    private suspend fun discard() {
        val uploadId = inputData.getString(UploadWorkData.KEY_UPLOAD_ID) ?: return
        withContext(NonCancellable + dispatchers.io) { staging.delete(uploadId) }
    }

    override suspend fun getForegroundInfo(): ForegroundInfo = foregroundInfo()

    /** Android 12+ may refuse to start a foreground service from the background; then we just run as normal work. */
    private suspend fun tryPromoteToForeground() {
        try {
            setForeground(foregroundInfo())
        } catch (cancellation: CancellationException) {
            throw cancellation
        } catch (@Suppress("TooGenericExceptionCaught") ignored: Exception) {
            // ForegroundServiceStartNotAllowedException / missing notification permission: continue in background.
        }
    }

    private fun foregroundInfo(): ForegroundInfo {
        val notification: Notification = NotificationCompat.Builder(applicationContext, UPLOAD_CHANNEL_ID)
            .setSmallIcon(android.R.drawable.stat_sys_upload)
            .setContentTitle(applicationContext.getString(R.string.media_upload_notification_title))
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setProgress(0, 0, true)
            .build()
        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            ForegroundInfo(id.hashCode(), notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC)
        } else {
            ForegroundInfo(id.hashCode(), notification)
        }
    }

    private companion object {
        const val PERCENT = 100
        const val DEFAULT_CONTENT_TYPE = "application/octet-stream"
    }
}
