package com.aedst.core.common

import kotlinx.coroutines.CoroutineDispatcher

/**
 * Injected instead of referencing `Dispatchers` directly, so tests can substitute a test dispatcher. The production
 * implementation is per target (`DefaultDispatcherProvider` in `androidMain`): `Dispatchers.IO` is not common API.
 */
public interface DispatcherProvider {
    public val main: CoroutineDispatcher
    public val io: CoroutineDispatcher
    public val default: CoroutineDispatcher
}
