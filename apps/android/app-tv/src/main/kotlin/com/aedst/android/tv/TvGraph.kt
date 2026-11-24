package com.aedst.android.tv

import android.content.Context
import com.aedst.core.common.AppInitializer
import com.aedst.core.common.ApplicationContext
import dev.zacsweers.metro.AppScope
import dev.zacsweers.metro.DependencyGraph
import dev.zacsweers.metro.Provides
import dev.zacsweers.metrox.viewmodel.ViewModelGraph

/**
 * The TV app's dependency graph: the same modules' contributions as the phone app's `AppGraph`, limited to what this
 * module depends on directly (Metro does not aggregate through transitive dependencies).
 */
@DependencyGraph(AppScope::class)
interface TvGraph : ViewModelGraph {
    /** Start-up work contributed by modules (telemetry first). */
    val initializers: Set<AppInitializer>

    fun inject(activity: MainTvActivity)

    @DependencyGraph.Factory
    fun interface Factory {
        fun create(@Provides @ApplicationContext context: Context): TvGraph
    }
}
