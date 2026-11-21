package com.aedst.core.common

import kotlinx.coroutines.withContext

/** Suspending use case: one entry point per application operation (mirrors a server module's `application` commands/queries). */
public abstract class UseCase<in Params, out T>(private val dispatcherProvider: DispatcherProvider) {
    public suspend operator fun invoke(params: Params): Outcome<T> = withContext(dispatcherProvider.io) {
        runCatchingOutcome { execute(params) }
    }

    protected abstract suspend fun execute(params: Params): T
}

/** For use cases that take no parameters. */
public abstract class NoParamsUseCase<out T>(private val dispatcherProvider: DispatcherProvider) {
    public suspend operator fun invoke(): Outcome<T> = withContext(dispatcherProvider.io) {
        runCatchingOutcome { execute() }
    }

    protected abstract suspend fun execute(): T
}
