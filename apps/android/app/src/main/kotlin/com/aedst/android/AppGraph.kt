package com.aedst.android

import android.content.Context
import com.aedst.core.common.AedstWorkerFactory
import com.aedst.core.common.AppInitializer
import com.aedst.core.common.ApplicationContext
import dev.zacsweers.metro.AppScope
import dev.zacsweers.metro.DependencyGraph
import dev.zacsweers.metro.Provides
import dev.zacsweers.metrox.viewmodel.ViewModelGraph

/**
 * The phone app's dependency graph (Metro's replacement for Hilt's `SingletonComponent`). Every `@ContributesTo`,
 * `@ContributesBinding`, `@ContributesIntoSet` and `@ContributesIntoMap` of the modules this module depends on
 * directly is merged in at compile time; [ViewModelGraph] adds the ViewModel multibindings.
 *
 * Metro does not aggregate through transitive dependencies, so a module that contributes bindings must be a direct
 * dependency of `app/build.gradle.kts` (`metro.hiddenDependencies` fails the build when one is missing).
 */
@DependencyGraph(AppScope::class)
interface AppGraph : ViewModelGraph {
    /** Start-up work contributed by modules (telemetry first, then channels, push sync, image loader, ...). */
    val initializers: Set<AppInitializer>

    /** WorkManager's factory: builds the `@AssistedInject` workers of `core/outbox` and `core/media`. */
    val workerFactory: AedstWorkerFactory

    fun inject(activity: MainActivity)

    @DependencyGraph.Factory
    fun interface Factory {
        fun create(@Provides @ApplicationContext context: Context): AppGraph
    }
}
