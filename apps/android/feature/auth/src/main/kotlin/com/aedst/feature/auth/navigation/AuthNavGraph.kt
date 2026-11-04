package com.aedst.feature.auth.navigation

import androidx.navigation3.runtime.EntryProviderScope
import androidx.navigation3.runtime.NavKey
import com.aedst.core.navigation.AccountKey
import com.aedst.core.navigation.AedstNavGraph
import com.aedst.core.navigation.AedstNavigator
import com.aedst.core.navigation.LoginKey
import com.aedst.core.navigation.TaskListKey
import com.aedst.feature.auth.presentation.account.AccountRoute
import com.aedst.feature.auth.presentation.devicelogin.DeviceLoginRoute
import com.aedst.feature.auth.presentation.login.LoginRoute

/**
 * feature/auth's public boundary — the only package `app/` (or any other feature) may import from this module.
 * Nothing in `domain/`, `data/` or `presentation/` is reachable from outside this package; see
 * docs/content/android/architecture.md.
 *
 * @param homeKey where a successful sign-in lands. The phone app uses the tasks list ([TaskListKey]); the TV app,
 *   which does not register the tasks graph yet, uses the account screen ([AccountKey]).
 * @param useDeviceFlow render [LoginKey] with the OAuth device flow (code + URL, polling; RFC 8628) instead of the
 *   browser flow. Android TV usually has no browser, so `app-tv` sets it; the phone keeps the default.
 * @param actionButton renders the primary action of the device sign-in and account screens: `app-tv` passes its
 *   D-pad button, the phone keeps the screens' own touch buttons (`null`).
 */
class AuthNavGraph(
    private val homeKey: NavKey = TaskListKey,
    private val useDeviceFlow: Boolean = false,
    private val actionButton: AuthActionButton? = null,
) : AedstNavGraph {
    override fun register(scope: EntryProviderScope<NavKey>, navigator: AedstNavigator) {
        scope.entry<LoginKey> {
            val onLoggedIn = { navigator.completeSignIn(homeKey) }
            if (useDeviceFlow) {
                DeviceLoginRoute(onLoggedIn = onLoggedIn, actionButton = actionButton)
            } else {
                LoginRoute(onLoggedIn = onLoggedIn)
            }
        }
        // Signing out needs no navigation callback: it clears the session and `app/` resets the back stacks.
        scope.entry<AccountKey> { AccountRoute(actionButton = actionButton) }
    }
}
