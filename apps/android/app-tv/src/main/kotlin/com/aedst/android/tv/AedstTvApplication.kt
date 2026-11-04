package com.aedst.android.tv

import android.app.Application
import com.aedst.core.common.AppInitializer
import dagger.hilt.android.HiltAndroidApp
import javax.inject.Inject

/**
 * TV counterpart to `:app`'s `AedstApplication`. Not shared from `:app`
 * directly: `AedstApplication` lives in `:app`'s own module (`com.aedst.android`),
 * not a `:core:*` module, so `:app-tv` cannot depend on it without depending
 * on the whole phone application module. This class stays a minimal
 * `@HiltAndroidApp` entry point — identical DI bootstrap pattern, own
 * package — with all real business logic living in the shared `:core:*` /
 * `:feature:*` modules both apps depend on.
 */
@HiltAndroidApp
class AedstTvApplication : Application() {

    /** Same module-contributed start-up work as the phone app (telemetry first). */
    @Inject
    lateinit var initializers: Set<@JvmSuppressWildcards AppInitializer>

    override fun onCreate() {
        super.onCreate()
        initializers.sortedBy(AppInitializer::priority).forEach(AppInitializer::initialize)
    }
}
