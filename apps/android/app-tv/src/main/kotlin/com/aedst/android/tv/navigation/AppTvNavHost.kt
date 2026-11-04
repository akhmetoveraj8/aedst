package com.aedst.android.tv.navigation

import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.lifecycle.viewmodel.navigation3.rememberViewModelStoreNavEntryDecorator
import androidx.navigation3.runtime.NavKey
import androidx.navigation3.runtime.entryProvider
import androidx.navigation3.runtime.rememberSaveableStateHolderNavEntryDecorator
import androidx.navigation3.ui.NavDisplay
import com.aedst.core.navigation.AccountKey
import com.aedst.core.navigation.AedstNavGraph
import com.aedst.core.navigation.LoginKey
import com.aedst.core.navigation.rememberAedstStackNavigator
import com.aedst.core.ui.tv.TvPrimaryButton
import com.aedst.feature.auth.navigation.AuthNavGraph

/**
 * TV counterpart to `:app`'s `AppNavHost` — same composition pattern (each feature's [AedstNavGraph] registers its
 * entries into one `entryProvider`), reusing the exact same `:feature:auth` nav graph and business logic. `app-tv/`
 * only knows about each feature's `navigation` entry point, never its domain/data/presentation packages, same boundary
 * rule as the phone app (see `apps/android/app/.../navigation/AppNavHost.kt` and
 * docs/content/android/architecture.md). A single back stack is enough here: there are no tabs.
 */
private val featureGraphs: List<AedstNavGraph> = listOf(
    // The TV app does not register the tasks graph yet, so sign-in lands on the account screen.
    // No browser on most TVs: sign in with the OAuth device flow (code + URL, approve on a phone).
    AuthNavGraph(
        homeKey = AccountKey,
        useDeviceFlow = true,
        // D-pad focus and scale feedback: the TV button instead of the touch AedstButton.
        actionButton = { text, onClick, modifier, enabled, _ -> TvPrimaryButton(text, onClick, modifier, enabled) },
    ),
)

@Composable
fun AppTvNavHost() {
    val navigator = rememberAedstStackNavigator(start = LoginKey)
    val provider = remember(navigator) {
        entryProvider<NavKey> { featureGraphs.forEach { graph -> graph.register(this, navigator) } }
    }
    NavDisplay(
        backStack = navigator.keys,
        onBack = navigator::back,
        entryDecorators = listOf(
            rememberSaveableStateHolderNavEntryDecorator<NavKey>(),
            rememberViewModelStoreNavEntryDecorator<NavKey>(),
        ),
        entryProvider = provider,
    )
}
