package com.aedst.core.common

import android.content.Context

/**
 * Implemented by each `Application`: hands out the dependency graph so Android components the system instantiates
 * (a `Service`, a content provider) can reach their dependencies without importing the application module.
 *
 * Metro has no `@AndroidEntryPoint`. A module that owns such a component contributes a public interface to
 * `AppScope` that exposes what the component needs, and the component reads it with [graphAs].
 */
public interface GraphProvider {
    /** The application's dependency graph. It implements every interface contributed to `AppScope`. */
    public val graph: Any
}

/** The application graph viewed as the contributed interface [T]. */
public inline fun <reified T : Any> Context.graphAs(): T {
    val provider = applicationContext as? GraphProvider
        ?: error("The Application must implement GraphProvider")
    return provider.graph as T
}
