package com.aedst.android

import android.app.Application
import android.content.pm.ApplicationInfo
import android.os.StrictMode
import androidx.hilt.work.HiltWorkerFactory
import androidx.work.Configuration
import com.aedst.core.common.AppInitializer
import dagger.hilt.android.HiltAndroidApp
import javax.inject.Inject

@HiltAndroidApp
class AedstApplication :
    Application(),
    Configuration.Provider {

    @Inject
    lateinit var workerFactory: HiltWorkerFactory

    /**
     * Start-up work contributed by modules (telemetry first, then notification channels, push sync, image loader…),
     * so `app/` never imports a feature's internals just to start it.
     */
    @Inject
    lateinit var initializers: Set<@JvmSuppressWildcards AppInitializer>

    /** On-demand WorkManager init (auto-initialiser removed in the manifest) so `@HiltWorker`s are injectable. */
    override val workManagerConfiguration: Configuration
        get() = Configuration.Builder().setWorkerFactory(workerFactory).build()

    override fun onCreate() {
        super.onCreate()
        if (applicationInfo.flags and ApplicationInfo.FLAG_DEBUGGABLE != 0) enableStrictMode()
        initializers.sortedBy(AppInitializer::priority).forEach(AppInitializer::initialize)
    }

    /** Debug builds only: log main-thread I/O and leaked resources instead of discovering them in production. */
    private fun enableStrictMode() {
        StrictMode.setThreadPolicy(
            StrictMode.ThreadPolicy.Builder().detectAll().penaltyLog().build(),
        )
        StrictMode.setVmPolicy(
            StrictMode.VmPolicy.Builder()
                .detectLeakedClosableObjects()
                .detectLeakedSqlLiteObjects()
                .penaltyLog()
                .build(),
        )
    }
}
