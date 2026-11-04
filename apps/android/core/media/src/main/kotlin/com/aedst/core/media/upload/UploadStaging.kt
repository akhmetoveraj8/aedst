package com.aedst.core.media.upload

import android.content.Context
import android.os.Build
import androidx.work.ListenableWorker
import androidx.work.WorkInfo
import com.aedst.core.common.DispatcherProvider
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.withContext
import java.io.File
import javax.inject.Inject
import javax.inject.Singleton

/**
 * The staged copies of picked media: `filesDir/media-uploads/<uploadId>[.ext]`. They live in `filesDir`, not the cache
 * dir, so the OS cannot evict a file between the three upload steps. Because nothing else removes them, every way an
 * upload can end must: [CompleteUploadWorker] on success, a terminal failure of any step, a cancel
 * ([MediaUploadScheduler.cancel]), the start-up [UploadStagingSweeper] (a process killed mid-upload) and sign-out.
 */
@Singleton
class UploadStaging @Inject constructor(
    @ApplicationContext private val context: Context,
    private val dispatchers: DispatcherProvider,
) {
    private val directory: File get() = File(context.filesDir, STAGING_DIR)

    /** The path stem for [uploadId]; the caller appends the extension of the (possibly re-encoded) file. */
    fun stem(uploadId: String): File = File(directory.apply { mkdirs() }, uploadId)

    /** Deletes the staged file(s) of one upload. Blocking disk I/O: call it off the main thread. */
    fun delete(uploadId: String) {
        directory.listFiles { file -> file.name.startsWith(uploadId) }?.forEach(File::delete)
    }

    /** Deletes every staged file whose upload is not in [activeUploadIds] (leftovers of a killed process). */
    suspend fun sweep(activeUploadIds: Set<String>): Int = withContext(dispatchers.io) {
        val stale = directory.listFiles { file -> activeUploadIds.none(file.name::startsWith) }.orEmpty()
        stale.count(File::delete)
    }

    /** Sign-out: nothing staged for the previous user may be uploaded or linger. */
    suspend fun deleteAll() = withContext(dispatchers.io) {
        directory.listFiles()?.forEach(File::delete)
    }

    companion object {
        const val STAGING_DIR = "media-uploads"
    }
}

/** `true` when WorkManager stopped this worker because the app cancelled the work, not because a constraint lapsed. */
internal val ListenableWorker.wasCancelledByApp: Boolean
    get() = Build.VERSION.SDK_INT >= Build.VERSION_CODES.S && stopReason == WorkInfo.STOP_REASON_CANCELLED_BY_APP
