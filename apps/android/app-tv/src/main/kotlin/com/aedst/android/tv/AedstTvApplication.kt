package com.aedst.android.tv

import android.app.Application
import com.aedst.core.common.AppInitializer
import com.aedst.core.common.GraphProvider
import dev.zacsweers.metro.createGraphFactory

/**
 * TV counterpart to `:app`'s `AedstApplication`. Not shared from `:app`
 * directly: `AedstApplication` lives in `:app`'s own module (`com.aedst.android`),
 * not a `:core:*` module, so `:app-tv` cannot depend on it without depending
 * on the whole phone application module. This class stays a minimal
 * entry point that owns the Metro [TvGraph] (identical DI bootstrap pattern, own
 * package) — with all real business logic living in the shared `:core:*` /
 * `:feature:*` modules both apps depend on.
 */
class AedstTvApplication :
    Application(),
    GraphProvider {

    val tvGraph: TvGraph by lazy { createGraphFactory<TvGraph.Factory>().create(this) }

    override val graph: Any get() = tvGraph

    override fun onCreate() {
        super.onCreate()
        // Same module-contributed start-up work as the phone app (telemetry first).
        tvGraph.initializers.sortedBy(AppInitializer::priority).forEach(AppInitializer::initialize)
    }
}
