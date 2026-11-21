package com.aedst.core.common

import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.Dispatchers
import javax.inject.Inject
import javax.inject.Singleton

/** The real dispatchers; bound to [DispatcherProvider] in [CommonModule]. */
@Singleton
public class DefaultDispatcherProvider @Inject constructor() : DispatcherProvider {
    override val main: CoroutineDispatcher get() = Dispatchers.Main
    override val io: CoroutineDispatcher get() = Dispatchers.IO
    override val default: CoroutineDispatcher get() = Dispatchers.Default
}
