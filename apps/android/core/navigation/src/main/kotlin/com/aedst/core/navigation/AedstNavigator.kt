package com.aedst.core.navigation

import androidx.navigation3.runtime.NavKey

/**
 * What a feature may do to the back stack. Features never see the stack itself, so the app shell can keep one stack
 * per tab, reset everything on sign-out, and keep the rules unit-testable without Compose.
 */
interface AedstNavigator {
    /**
     * Opens [key] on top of the active stack (a no-op when it is already on top). A top-level destination such as
     * [NotificationsKey] switches to its tab instead of being pushed.
     */
    fun navigate(key: NavKey)

    /** Pops the active stack; at the root of a non-start tab it returns to the start tab. */
    fun back()

    /** Replaces the top of the active stack with [key], e.g. a created task replaces its create form. */
    fun replaceTop(key: NavKey)

    /** The user signed in: leave the auth stack and land on [home]. */
    fun completeSignIn(home: NavKey)
}
