package com.aedst.core.common

import dev.zacsweers.metro.AppScope
import dev.zacsweers.metro.ContributesTo
import dev.zacsweers.metro.Multibinds

/**
 * Declares the hook sets of `AppLifecycleHooks.kt`, so a graph that links no contributor still builds. Modules add
 * to them with `@ContributesIntoSet(AppScope::class, binding<AppInitializer>())` on the implementing class.
 * [ErrorReporter] needs no declaration: consumers take it as an optional (default `null`) parameter.
 */
@ContributesTo(AppScope::class)
public interface AppLifecycleHooksBindings {
    @Multibinds(allowEmpty = true)
    public val appInitializers: Set<AppInitializer>

    @Multibinds(allowEmpty = true)
    public val signOutHooks: Set<SignOutHook>
}
