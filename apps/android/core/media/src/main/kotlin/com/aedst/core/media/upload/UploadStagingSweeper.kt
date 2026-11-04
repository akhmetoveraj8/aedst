package com.aedst.core.media.upload

import com.aedst.core.common.AppInitializer
import com.aedst.core.common.ApplicationScope
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.launch
import javax.inject.Inject

/**
 * At process start, removes staged files that no unfinished upload owns: the app was killed (or the user swiped it
 * away) between staging a file and the work that would have deleted it, and WorkManager has since dropped the chain.
 */
class UploadStagingSweeper @Inject constructor(
    private val staging: UploadStaging,
    private val scheduler: MediaUploadScheduler,
    @ApplicationScope private val scope: CoroutineScope,
) : AppInitializer {
    override fun initialize() {
        scope.launch { staging.sweep(scheduler.activeUploadIds()) }
    }
}
