package com.aedst.core.common

import dagger.BindsOptionalOf
import dagger.Module
import dagger.hilt.InstallIn
import dagger.hilt.components.SingletonComponent
import dagger.multibindings.Multibinds

/** Hilt declarations for the hook sets of `AppLifecycleHooks.kt` (Hilt is JVM-only, so the wiring is `androidMain`). */
@Module
@InstallIn(SingletonComponent::class)
public abstract class AppLifecycleHooksModule {
    @Multibinds
    public abstract fun appInitializers(): Set<AppInitializer>

    @Multibinds
    public abstract fun signOutHooks(): Set<SignOutHook>

    @BindsOptionalOf
    public abstract fun errorReporter(): ErrorReporter
}
