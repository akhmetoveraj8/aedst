package com.aedst.core.media.upload

import android.content.Context
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters
import androidx.work.workDataOf
import com.aedst.core.common.AedstError
import com.aedst.core.common.DispatcherProvider
import com.aedst.core.common.WorkerAssistedFactory
import com.aedst.core.common.WorkerKey
import com.aedst.core.media.data.MediaUploadApi
import com.aedst.core.network.toAedstError
import dev.zacsweers.metro.AppScope
import dev.zacsweers.metro.Assisted
import dev.zacsweers.metro.AssistedFactory
import dev.zacsweers.metro.AssistedInject
import dev.zacsweers.metro.ContributesIntoMap
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.withContext

/**
 * Step 3/3: `CompleteUpload` — the server verifies the object, then processes it (variants) in a River job and
 * notifies with `MEDIA_READY`. Deletes the staged local file on success and on a terminal failure.
 */
@AssistedInject
class CompleteUploadWorker(
    @Assisted appContext: Context,
    @Assisted params: WorkerParameters,
    private val uploadApi: MediaUploadApi,
    private val staging: UploadStaging,
    private val dispatchers: DispatcherProvider,
) : CoroutineWorker(appContext, params) {

    @WorkerKey(CompleteUploadWorker::class)
    @ContributesIntoMap(AppScope::class)
    @AssistedFactory
    fun interface Factory : WorkerAssistedFactory {
        override fun create(appContext: Context, params: WorkerParameters): CompleteUploadWorker
    }

    override suspend fun doWork(): Result {
        val mediaId = inputData.getString(UploadWorkData.KEY_MEDIA_ID)
            ?: return failed(AedstError.InvalidInput("Media id missing"))
        return try {
            uploadApi.completeUpload(mediaId)
            discard()
            Result.success(workDataOf(UploadWorkData.KEY_MEDIA_ID to mediaId))
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
}
