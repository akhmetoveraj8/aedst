package com.aedst.core.common

import dagger.Binds
import dagger.Module
import dagger.Provides
import dagger.hilt.InstallIn
import dagger.hilt.components.SingletonComponent
import kotlinx.coroutines.CoroutineExceptionHandler
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.SupervisorJob
import java.util.Optional
import javax.inject.Qualifier
import javax.inject.Singleton
import kotlin.time.Clock

/** Qualifier for the process-lifetime [CoroutineScope] (work that must outlive any screen). */
@Qualifier
@Retention(AnnotationRetention.RUNTIME)
public annotation class ApplicationScope

@Module
@InstallIn(SingletonComponent::class)
public abstract class CommonModule {

    @Binds
    public abstract fun bindDispatcherProvider(impl: DefaultDispatcherProvider): DispatcherProvider

    public companion object {
        /** Injected so time-dependent logic (token expiry) is testable with a fixed clock. */
        @Provides
        public fun provideClock(): Clock = Clock.System

        /**
         * Process-lifetime scope. A failure in one launched job neither cancels its siblings ([SupervisorJob]) nor
         * crashes the process: it is logged and sent to the [ErrorReporter] (Sentry) as a non-fatal. Truly uncaught
         * exceptions on other threads are handled by Sentry's uncaught-exception integration.
         */
        @Provides
        @Singleton
        @ApplicationScope
        public fun provideApplicationScope(
            dispatchers: DispatcherProvider,
            logger: Logger,
            errorReporter: Optional<ErrorReporter>,
        ): CoroutineScope {
            val handler = CoroutineExceptionHandler { _, throwable ->
                logger.error("ApplicationScope", "Uncaught exception in application scope", throwable)
                errorReporter.ifPresent { it.recordNonFatal(throwable) }
            }
            return CoroutineScope(SupervisorJob() + dispatchers.default + handler)
        }
    }
}
