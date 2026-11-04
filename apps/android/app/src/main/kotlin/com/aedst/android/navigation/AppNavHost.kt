package com.aedst.android.navigation

import androidx.annotation.StringRes
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.AdminPanelSettings
import androidx.compose.material.icons.filled.Checklist
import androidx.compose.material.icons.filled.Person
import androidx.compose.material.icons.filled.PhotoLibrary
import androidx.compose.material.icons.filled.Search
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.material3.adaptive.navigationsuite.NavigationSuiteItem
import androidx.compose.material3.adaptive.navigationsuite.NavigationSuiteScaffold
import androidx.compose.material3.adaptive.navigationsuite.NavigationSuiteScaffoldValue
import androidx.compose.material3.adaptive.navigationsuite.rememberNavigationSuiteScaffoldState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.res.stringResource
import androidx.lifecycle.viewmodel.navigation3.rememberViewModelStoreNavEntryDecorator
import androidx.navigation3.runtime.NavEntry
import androidx.navigation3.runtime.NavKey
import androidx.navigation3.runtime.entryProvider
import androidx.navigation3.runtime.rememberDecoratedNavEntries
import androidx.navigation3.runtime.rememberSaveableStateHolderNavEntryDecorator
import androidx.navigation3.ui.NavDisplay
import com.aedst.android.R
import com.aedst.core.analytics.NavigationTelemetry
import com.aedst.core.common.FeatureAvailability
import com.aedst.core.navigation.AedstKey
import com.aedst.core.navigation.AedstNavGraph
import com.aedst.core.navigation.AedstRoutes
import com.aedst.core.navigation.AedstTab
import com.aedst.core.navigation.rememberAedstTabNavigator
import com.aedst.feature.admin.navigation.AdminNavGraph
import com.aedst.feature.auth.navigation.AuthNavGraph
import com.aedst.feature.media.navigation.MediaNavGraph
import com.aedst.feature.notifications.navigation.NotificationPermissionRequest
import com.aedst.feature.notifications.navigation.NotificationsBadgedIcon
import com.aedst.feature.notifications.navigation.NotificationsNavGraph
import com.aedst.feature.search.navigation.SearchNavGraph
import com.aedst.feature.tasks.navigation.TasksNavGraph

/**
 * Composes every feature's [AedstNavGraph] into one `entryProvider`. `app/` only knows about each feature's
 * `navigation` entry point — never its domain/data/presentation packages — the same boundary a server module's `api/`
 * package enforces (see core/navigation and docs/content/android/architecture.md).
 */
private val featureGraphs: List<AedstNavGraph> = listOf(
    AuthNavGraph(),
    TasksNavGraph(),
    SearchNavGraph(),
    NotificationsNavGraph(),
    MediaNavGraph(),
    AdminNavGraph(),
)

private data class TopLevelDestination(val tab: AedstTab, @StringRes val label: Int, val icon: @Composable () -> Unit)

private fun vectorIcon(image: ImageVector): @Composable () -> Unit = { Icon(image, contentDescription = null) }

/**
 * The Navigation 3 shell: the back stacks are app-owned lists (`rememberAedstTabNavigator`), `NavDisplay` renders the
 * entries, and `NavigationSuiteScaffold` shows a bottom bar on phones and a rail on tablets/foldables.
 *
 * @param isSignedIn `null` while the session is still being restored (nothing is drawn; the splash screen covers it).
 *   The session is the single source of truth for which side of the auth boundary the user is on, so a refresh token
 *   rejected in the background sends the user back to sign-in from any screen (every back stack is reset).
 * @param isAdmin shows the admin tab (UI gating only; the server authorises every admin RPC).
 * @param features what capability negotiation leaves enabled: a disabled feature loses its tab and its deep links.
 * @param pendingRoute a validated route from a tapped notification, opened once the user is signed in.
 */
@Composable
fun AppNavHost(
    isSignedIn: Boolean?,
    isAdmin: Boolean,
    features: FeatureAvailability,
    pendingRoute: String?,
    onPendingRouteHandled: () -> Unit,
    navigationTelemetry: NavigationTelemetry,
    modifier: Modifier = Modifier,
) {
    if (isSignedIn == null) return
    val currentOnPendingRouteHandled by rememberUpdatedState(onPendingRouteHandled)

    val navigator = rememberAedstTabNavigator(isSignedIn)
    val provider = remember(navigator) {
        entryProvider<NavKey> { featureGraphs.forEach { graph -> graph.register(this, navigator) } }
    }

    // The session drives the auth boundary; a notification link is opened once, and only when signed in.
    LaunchedEffect(isSignedIn, pendingRoute, features) {
        navigator.setSignedIn(isSignedIn)
        if (isSignedIn && pendingRoute != null) {
            if (features.isEnabled(AedstRoutes.featureForRoute(pendingRoute))) {
                AedstRoutes.keyForRoute(pendingRoute)?.let(navigator::navigate)
            }
            currentOnPendingRouteHandled()
        }
    }
    // Capability negotiation and the admin role decide which tabs exist; the selected one moves if its tab goes away.
    val enabledTabs = remember(features, isAdmin) { enabledTabs(features, isAdmin) }
    LaunchedEffect(enabledTabs) { navigator.enabledTabs = enabledTabs }

    val topScreen = (navigator.topKey as? AedstKey)?.screenName
    LaunchedEffect(topScreen) { topScreen?.let(navigationTelemetry::onScreenChanged) }

    if (isSignedIn) NotificationPermissionRequest()

    // One decorated entry list per back stack: each keeps its saved state and ViewModels while another tab is shown.
    val authEntries = key("auth") { rememberStackEntries(navigator.signedOutStack, provider) }
    val tabEntries = AedstTab.entries.associateWith { tab ->
        key(tab) { rememberStackEntries(navigator.stackOf(tab), provider) }
    }
    val startEntries = tabEntries.getValue(navigator.startTab)
    val entries = when {
        !navigator.isSignedIn -> authEntries
        navigator.currentTab == navigator.startTab -> startEntries
        // The start tab's root sits below the current tab, so back from a tab's root returns to it.
        else -> startEntries.take(1) + tabEntries.getValue(navigator.currentTab)
    }

    val destinations = remember(enabledTabs) { topLevelDestinations().filter { it.tab in enabledTabs } }
    val showNavigation = navigator.isAtTabRoot
    val initialValue = if (showNavigation) NavigationSuiteScaffoldValue.Visible else NavigationSuiteScaffoldValue.Hidden
    val scaffoldState = rememberNavigationSuiteScaffoldState(initialValue)
    LaunchedEffect(showNavigation) {
        if (showNavigation) scaffoldState.show() else scaffoldState.hide()
    }

    NavigationSuiteScaffold(
        navigationItems = {
            destinations.forEach { destination ->
                NavigationSuiteItem(
                    selected = navigator.currentTab == destination.tab,
                    onClick = { navigator.switchTab(destination.tab) },
                    icon = destination.icon,
                    label = { Text(stringResource(destination.label)) },
                )
            }
        },
        state = scaffoldState,
        modifier = modifier,
    ) {
        NavDisplay(entries = entries, onBack = navigator::back)
    }
}

/**
 * Decorates one back stack: [rememberSaveableStateHolderNavEntryDecorator] keeps `rememberSaveable` state per entry and
 * [rememberViewModelStoreNavEntryDecorator] scopes ViewModels (and `hiltViewModel()`) to the entry, clearing them when
 * the entry leaves the stack.
 */
@Composable
private fun rememberStackEntries(
    stack: List<NavKey>,
    entryProvider: (NavKey) -> NavEntry<NavKey>,
): List<NavEntry<NavKey>> {
    val decorators = listOf(
        rememberSaveableStateHolderNavEntryDecorator<NavKey>(),
        rememberViewModelStoreNavEntryDecorator<NavKey>(),
    )
    return rememberDecoratedNavEntries(backStack = stack, entryDecorators = decorators, entryProvider = entryProvider)
}

private fun topLevelDestinations(): List<TopLevelDestination> = listOf(
    TopLevelDestination(AedstTab.TASKS, R.string.nav_tasks, vectorIcon(Icons.Filled.Checklist)),
    TopLevelDestination(AedstTab.SEARCH, R.string.nav_search, vectorIcon(Icons.Filled.Search)),
    TopLevelDestination(AedstTab.NOTIFICATIONS, R.string.nav_notifications) { NotificationsBadgedIcon() },
    TopLevelDestination(AedstTab.MEDIA, R.string.nav_media, vectorIcon(Icons.Filled.PhotoLibrary)),
    TopLevelDestination(AedstTab.ACCOUNT, R.string.nav_account, vectorIcon(Icons.Filled.Person)),
    TopLevelDestination(AedstTab.ADMIN, R.string.nav_admin, vectorIcon(Icons.Filled.AdminPanelSettings)),
)

/** A tab is offered when its capability is on (the account tab has none); the admin tab also needs the admin role. */
private fun enabledTabs(features: FeatureAvailability, isAdmin: Boolean): Set<AedstTab> = AedstTab.entries
    .filter { tab -> tab.feature == null || features.isEnabled(tab.feature) }
    .filter { tab -> tab != AedstTab.ADMIN || isAdmin }
    .toSet()
