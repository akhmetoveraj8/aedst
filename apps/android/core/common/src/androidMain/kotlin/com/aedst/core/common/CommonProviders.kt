package com.aedst.core.common

import dev.zacsweers.metro.AppScope
import dev.zacsweers.metro.BindingContainer
import dev.zacsweers.metro.ContributesTo
import dev.zacsweers.metro.Provides
import dev.zacsweers.metro.Qualifier
import dev.zacsweers.metro.SingleIn
import kotlinx.coroutines.CoroutineExceptionHandler
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.SupervisorJob
import kotlin.time.Clock

/** Qualifier for the process-lifetime [CoroutineScope] (work that must outlive any screen). */
@Qualifier
@Retention(AnnotationRetention.RUNTIME)
public annotation class ApplicationScope

/**
 * Qualifier for the application [android.content.Context]. The graph factory of each application module provides it
 * (`@Provides @ApplicationContext context`), so a class never gets an Activity or Service context by accident.
 */
@Qualifier
@Retention(AnnotationRetention.RUNTIME)
public annotation class ApplicationContext

@BindingContainer
@ContributesTo(AppScope::class)
public object CommonProviders {

    /** Injected so time-dependent logic (token expiry) is testable with a fixed clock. */
    @Provides
    public fun provideClock(): Clock = Clock.System

    /**
     * Process-lifetime scope. A failure in one launched job neither cancels its siblings ([SupervisorJob]) nor
     * crashes the process: it is logged and sent to the [ErrorReporter] (Sentry) as a non-fatal. Truly uncaught
     * exceptions on other threads are handled by Sentry's uncaught-exception integration.
     *
     * [errorReporter] is an optional binding (Metro: a default value): modules and tests that do not include
     * telemetry still build.
     */
    @Provides
    @SingleIn(AppScope::class)
    @ApplicationScope
    public fun provideApplicationScope(
        dispatchers: DispatcherProvider,
        logger: Logger,
        errorReporter: ErrorReporter? = null,
    ): CoroutineScope {
        val handler = CoroutineExceptionHandler { _, throwable ->
            logger.error("ApplicationScope", "Uncaught exception in application scope", throwable)
            errorReporter?.recordNonFatal(throwable)
        }
        return CoroutineScope(SupervisorJob() + dispatchers.default + handler)
    }
}
