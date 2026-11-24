package com.aedst.android

import android.app.Application
import android.content.pm.ApplicationInfo
import android.os.StrictMode
import androidx.work.Configuration
import com.aedst.core.common.AppInitializer
import com.aedst.core.common.GraphProvider
import dev.zacsweers.metro.createGraphFactory

class AedstApplication :
    Application(),
    Configuration.Provider,
    GraphProvider {

    /** Created before anything else runs: Activities, Services and WorkManager read it. */
    val appGraph: AppGraph by lazy { createGraphFactory<AppGraph.Factory>().create(this) }

    override val graph: Any get() = appGraph

    /** On-demand WorkManager init (auto-initialiser removed in the manifest) so `@AssistedInject` workers are injectable. */
    override val workManagerConfiguration: Configuration
        get() = Configuration.Builder().setWorkerFactory(appGraph.workerFactory).build()

    override fun onCreate() {
        super.onCreate()
        if (applicationInfo.flags and ApplicationInfo.FLAG_DEBUGGABLE != 0) enableStrictMode()
        // Start-up work contributed by modules (telemetry first), so `app/` never imports a feature's internals just
        // to start it.
        appGraph.initializers.sortedBy(AppInitializer::priority).forEach(AppInitializer::initialize)
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
