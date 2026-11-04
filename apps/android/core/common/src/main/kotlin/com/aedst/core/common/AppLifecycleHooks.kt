package com.aedst.core.common

import dagger.BindsOptionalOf
import dagger.Module
import dagger.hilt.InstallIn
import dagger.hilt.components.SingletonComponent
import dagger.multibindings.Multibinds

/**
 * Process-start work a module needs (notification channels, telemetry SDK init, push token sync). Modules contribute
 * one with `@Binds @IntoSet`; `app/`'s `Application.onCreate` runs them all. This keeps `app/` from importing any
 * feature's data/domain packages just to start it.
 */
interface AppInitializer {
    /** Lower runs first. Telemetry uses [PRIORITY_TELEMETRY] so crashes in later initializers are captured. */
    val priority: Int get() = PRIORITY_DEFAULT

    /** Called on the main thread from `Application.onCreate`: keep it cheap, launch real work on a scope. */
    fun initialize()

    companion object {
        const val PRIORITY_TELEMETRY = 0
        const val PRIORITY_DEFAULT = 100
    }
}

/**
 * Work tied to the end of a session. Modules contribute one with `@Binds @IntoSet`; `feature/auth` calls it. Each
 * method is best-effort and must not throw for expected failures.
 *
 *  - [beforeSignOut]: needs the session while it is still valid (e.g. `UnregisterPushDevice` needs the bearer token).
 *    Only an explicit sign-out runs it; when the IdP rejects the refresh token there is no valid session left.
 *  - [onSessionEnded]: wipes local data that belongs to the user (queued writes, caches, counters) so the next user
 *    of the device never sees or sends it. Runs after the session has been cleared, on both paths: an explicit
 *    sign-out and a rejected refresh token.
 */
interface SignOutHook {
    suspend fun beforeSignOut() = Unit

    suspend fun onSessionEnded() = Unit
}

/**
 * Non-fatal error sink (implemented by `core/analytics` with Sentry). Optional in the graph so modules and tests that
 * do not include telemetry still build.
 */
fun interface ErrorReporter {
    fun recordNonFatal(throwable: Throwable)
}

@Module
@InstallIn(SingletonComponent::class)
abstract class AppLifecycleHooksModule {
    @Multibinds
    abstract fun appInitializers(): Set<AppInitializer>

    @Multibinds
    abstract fun signOutHooks(): Set<SignOutHook>

    @BindsOptionalOf
    abstract fun errorReporter(): ErrorReporter
}
