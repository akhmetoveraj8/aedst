package com.aedst.core.media.upload

import android.content.Context
import android.content.Intent
import android.net.Uri
import androidx.work.BackoffPolicy
import androidx.work.Constraints
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequest
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkInfo
import androidx.work.WorkManager
import androidx.work.workDataOf
import com.aedst.core.common.ApplicationScope
import com.aedst.core.common.DispatcherProvider
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.launch
import java.util.UUID
import java.util.concurrent.TimeUnit
import javax.inject.Inject
import javax.inject.Singleton

/** UI-facing state of one upload (one WorkManager chain). */
data class UploadProgress(
    val uploadId: String,
    val sourceUri: Uri,
    val state: State,
    /** 0..1 while [State.UPLOADING]; `null` when indeterminate. */
    val fraction: Float?,
    /** Error kind (`AedstError` class name) when [State.FAILED]. */
    val errorKind: String?,
) {
    enum class State { PREPARING, UPLOADING, FINISHING, DONE, FAILED, CANCELLED }
}

/**
 * Front door of the upload pipeline: `enqueue` a Photo Picker URI (optionally attached to a task) and observe
 * progress per task. Each upload is a unique WorkManager chain
 * `PrepareUploadWorker → TransferUploadWorker → CompleteUploadWorker`, network-constrained, exponential backoff,
 * surviving process death and reboots (WorkManager persists it) — no custom scheduler.
 */
@Singleton
class MediaUploadScheduler @Inject constructor(
    @ApplicationContext private val context: Context,
    private val staging: UploadStaging,
    private val dispatchers: DispatcherProvider,
    @ApplicationScope private val scope: CoroutineScope,
) {

    private val workManager get() = WorkManager.getInstance(context)

    /** Returns the upload id. Call from the picker callback (the URI grant is taken here). */
    fun enqueue(source: Uri, taskId: String? = null): String {
        persistReadGrant(source)
        val uploadId = UUID.randomUUID().toString()
        val tags = listOfNotNull(TAG_ALL, tagForUpload(uploadId), tagForUri(source), taskId?.let { tagForTask(it) })
        val prepare = request<PrepareUploadWorker>(tags, STEP_PREPARE) {
            setInputData(
                workDataOf(
                    UploadWorkData.KEY_UPLOAD_ID to uploadId,
                    UploadWorkData.KEY_SOURCE_URI to source.toString(),
                    UploadWorkData.KEY_TASK_ID to taskId,
                ),
            )
        }
        workManager
            .beginUniqueWork(uniqueName(uploadId), ExistingWorkPolicy.KEEP, prepare)
            .then(request<TransferUploadWorker>(tags, STEP_TRANSFER))
            .then(request<CompleteUploadWorker>(tags, STEP_COMPLETE))
            .enqueue()
        return uploadId
    }

    /** Stops the chain and removes the staged copy (the running step also removes it when it unwinds). */
    fun cancel(uploadId: String) {
        workManager.cancelUniqueWork(uniqueName(uploadId))
        scope.launch(dispatchers.io) { staging.delete(uploadId) }
    }

    /** Sign-out: every upload in flight belongs to the user who left. */
    fun cancelAll() {
        workManager.cancelAllWorkByTag(TAG_ALL)
    }

    /** Ids of the uploads whose chain has not finished (enqueued, running or waiting for a retry). */
    suspend fun activeUploadIds(): Set<String> = workManager.getWorkInfosByTagFlow(TAG_ALL).first()
        .filterNot { it.state.isFinished }
        .mapNotNull(::uploadIdOf)
        .toSet()

    /** Uploads attached to [taskId] (or every upload when `null`), newest state per upload. */
    fun observe(taskId: String? = null): Flow<List<UploadProgress>> =
        workManager.getWorkInfosByTagFlow(taskId?.let { tagForTask(it) } ?: TAG_ALL)
            .map { infos ->
                infos.groupBy { uploadIdOf(it) }.mapNotNull { (id, steps) -> id?.let { progressOf(it, steps) } }
            }

    private fun progressOf(uploadId: String, steps: List<WorkInfo>): UploadProgress? {
        val uri = steps.firstNotNullOfOrNull { uriOf(it) } ?: return null
        val byStep = steps.associateBy { stepOf(it) }
        val failed = steps.firstOrNull { it.state == WorkInfo.State.FAILED }
        val transfer = byStep[STEP_TRANSFER]
        val state = when {
            failed != null -> UploadProgress.State.FAILED
            steps.any { it.state == WorkInfo.State.CANCELLED } -> UploadProgress.State.CANCELLED
            byStep[STEP_COMPLETE]?.state == WorkInfo.State.SUCCEEDED -> UploadProgress.State.DONE
            transfer?.state == WorkInfo.State.SUCCEEDED -> UploadProgress.State.FINISHING
            transfer?.state == WorkInfo.State.RUNNING -> UploadProgress.State.UPLOADING
            else -> UploadProgress.State.PREPARING
        }
        val fraction = transfer?.progress?.getFloat(UploadWorkData.KEY_PROGRESS, -1f)?.takeIf { it >= 0f }
        return UploadProgress(
            uploadId = uploadId,
            sourceUri = uri,
            state = state,
            fraction = if (state == UploadProgress.State.UPLOADING) fraction else null,
            errorKind = failed?.outputData?.getString(UploadWorkData.KEY_ERROR),
        )
    }

    /** Photo Picker URIs support persistable grants: keep read access if the work runs after a process restart. */
    private fun persistReadGrant(source: Uri) {
        runCatching {
            context.contentResolver.takePersistableUriPermission(source, Intent.FLAG_GRANT_READ_URI_PERMISSION)
        }
    }

    private inline fun <reified W : androidx.work.ListenableWorker> request(
        tags: List<String>,
        step: String,
        configure: OneTimeWorkRequest.Builder.() -> Unit = {},
    ): OneTimeWorkRequest = OneTimeWorkRequestBuilder<W>()
        .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
        .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, BACKOFF_SECONDS, TimeUnit.SECONDS)
        .apply {
            tags.forEach { addTag(it) }
            addTag(STEP_TAG_PREFIX + step)
            configure()
        }
        .build()

    private companion object {
        const val TAG_ALL = "media-upload"
        const val UPLOAD_TAG_PREFIX = "media-upload-id:"
        const val URI_TAG_PREFIX = "media-upload-uri:"
        const val TASK_TAG_PREFIX = "media-upload-task:"
        const val STEP_TAG_PREFIX = "media-upload-step:"
        const val STEP_PREPARE = "prepare"
        const val STEP_TRANSFER = "transfer"
        const val STEP_COMPLETE = "complete"
        const val BACKOFF_SECONDS = 30L

        fun uniqueName(uploadId: String) = "media-upload-$uploadId"
        fun tagForUpload(uploadId: String) = UPLOAD_TAG_PREFIX + uploadId
        fun tagForUri(uri: Uri) = URI_TAG_PREFIX + uri
        fun tagForTask(taskId: String) = TASK_TAG_PREFIX + taskId

        fun uploadIdOf(info: WorkInfo): String? =
            info.tags.firstOrNull { it.startsWith(UPLOAD_TAG_PREFIX) }?.removePrefix(UPLOAD_TAG_PREFIX)

        fun uriOf(info: WorkInfo): Uri? =
            info.tags.firstOrNull { it.startsWith(URI_TAG_PREFIX) }?.removePrefix(URI_TAG_PREFIX)?.let(Uri::parse)

        fun stepOf(info: WorkInfo): String? =
            info.tags.firstOrNull { it.startsWith(STEP_TAG_PREFIX) }?.removePrefix(STEP_TAG_PREFIX)
    }
}
