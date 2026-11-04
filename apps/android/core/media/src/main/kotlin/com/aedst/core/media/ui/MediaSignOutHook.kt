package com.aedst.core.media.ui

import android.content.Context
import coil3.SingletonImageLoader
import com.aedst.core.common.DispatcherProvider
import com.aedst.core.common.SignOutHook
import com.aedst.core.media.upload.MediaUploadScheduler
import com.aedst.core.media.upload.UploadStaging
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.withContext
import javax.inject.Inject

/**
 * Media belongs to the signed-in user. When the session ends, uploads still in flight are cancelled and their staged
 * copies deleted, and Coil's memory and disk caches (the previous user's thumbnails and photos) are emptied, so
 * the next user of the device never sees or sends them.
 */
class MediaSignOutHook @Inject constructor(
    @ApplicationContext private val context: Context,
    private val uploads: MediaUploadScheduler,
    private val staging: UploadStaging,
    private val dispatchers: DispatcherProvider,
) : SignOutHook {
    override suspend fun onSessionEnded() {
        uploads.cancelAll()
        staging.deleteAll()
        val images = SingletonImageLoader.get(context)
        images.memoryCache?.clear()
        // Clearing the disk cache deletes files: keep it off the main thread.
        withContext(dispatchers.io) { images.diskCache?.clear() }
    }
}
