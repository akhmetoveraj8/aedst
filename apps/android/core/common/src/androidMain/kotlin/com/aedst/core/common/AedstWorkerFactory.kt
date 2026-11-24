package com.aedst.core.common

import android.content.Context
import androidx.work.ListenableWorker
import androidx.work.WorkerFactory
import androidx.work.WorkerParameters
import dev.zacsweers.metro.AppScope
import dev.zacsweers.metro.ContributesTo
import dev.zacsweers.metro.Inject
import dev.zacsweers.metro.MapKey
import dev.zacsweers.metro.Multibinds
import kotlin.reflect.KClass

/**
 * Map key of a worker's factory in the worker multibinding. On a class or on the factory interface Metro infers the
 * value (`@WorkerKey` alone), the same way `@ViewModelKey` works.
 */
@MapKey
@Retention(AnnotationRetention.RUNTIME)
public annotation class WorkerKey(public val value: KClass<out ListenableWorker>)

/**
 * Implemented by the `@AssistedFactory` nested in each worker. WorkManager supplies the [Context] and
 * [WorkerParameters] (the two `@Assisted` constructor parameters, matched to this function by name); Metro supplies
 * everything else.
 *
 * ```
 * @AssistedInject
 * class SyncWorker(@Assisted appContext: Context, @Assisted params: WorkerParameters, ...) : CoroutineWorker(...) {
 *     @WorkerKey(SyncWorker::class)
 *     @ContributesIntoMap(AppScope::class)
 *     @AssistedFactory
 *     fun interface Factory : WorkerAssistedFactory {
 *         override fun create(appContext: Context, params: WorkerParameters): SyncWorker
 *     }
 * }
 * ```
 */
public fun interface WorkerAssistedFactory {
    public fun create(appContext: Context, params: WorkerParameters): ListenableWorker
}

/**
 * The application's [WorkerFactory] (Metro's replacement for `HiltWorkerFactory`): picks the factory whose worker class
 * name WorkManager asks for. An unknown name returns `null`, so WorkManager falls back to its reflective default.
 */
@Inject
public class AedstWorkerFactory(
    private val factories: Map<KClass<out ListenableWorker>, () -> WorkerAssistedFactory>,
) : WorkerFactory() {

    override fun createWorker(
        appContext: Context,
        workerClassName: String,
        workerParameters: WorkerParameters,
    ): ListenableWorker? = factories.entries
        .firstOrNull { (workerClass, _) -> workerClass.java.name == workerClassName }
        ?.value
        ?.invoke()
        ?.create(appContext, workerParameters)
}

/** Declares the worker multibinding, so a graph that links no worker (for example a TV build) still builds. */
@ContributesTo(AppScope::class)
public interface WorkerBindings {
    @Multibinds(allowEmpty = true)
    public val workerFactories: Map<KClass<out ListenableWorker>, WorkerAssistedFactory>
}
