package com.aedst.core.navigation

import androidx.navigation3.runtime.EntryProviderScope
import androidx.navigation3.runtime.NavKey

/**
 * The boundary every `feature` module exposes to `app/` — the Android analog of a server module's `api/` package
 * (see docs/content/android/architecture.md). `app/` only ever imports a feature's `navigation` package; a feature's
 * `domain`, `data` and `presentation` packages are never referenced from outside the feature.
 *
 * With Navigation 3 a feature contributes *entries* (key -> composable) to one shared `entryProvider`; the back stack
 * itself is owned by `app/` and reached only through the [AedstNavigator] handed to [register].
 */
interface AedstNavGraph {
    /** Registers this feature's destinations on the shared [scope]; navigate away through [navigator] only. */
    fun register(scope: EntryProviderScope<NavKey>, navigator: AedstNavigator)
}
