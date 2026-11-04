package com.aedst.feature.notifications.navigation

import android.Manifest
import android.content.pm.PackageManager
import android.os.Build
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Notifications
import androidx.compose.material3.BadgedBox
import androidx.compose.material3.Icon
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.NonRestartableComposable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.pluralStringResource
import androidx.core.content.ContextCompat
import androidx.hilt.lifecycle.viewmodel.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.navigation3.runtime.EntryProviderScope
import androidx.navigation3.runtime.NavKey
import com.aedst.core.navigation.AedstNavGraph
import com.aedst.core.navigation.AedstNavigator
import com.aedst.core.navigation.AedstRoutes
import com.aedst.core.navigation.NotificationPreferencesKey
import com.aedst.core.navigation.NotificationsKey
import com.aedst.core.ui.components.AedstCountBadge
import com.aedst.feature.notifications.R
import com.aedst.feature.notifications.presentation.UnreadBadgeViewModel
import com.aedst.feature.notifications.presentation.inbox.InboxRoute
import com.aedst.feature.notifications.presentation.preferences.NotificationPreferencesRoute

/**
 * feature/notifications' public boundary: the inbox + preferences destinations, the unread badge icon for the app's
 * navigation bar, and the POST_NOTIFICATIONS request. Push registration starts by itself (an `AppInitializer`).
 */
class NotificationsNavGraph : AedstNavGraph {
    override fun register(scope: EntryProviderScope<NavKey>, navigator: AedstNavigator) {
        scope.entry<NotificationsKey> {
            InboxRoute(
                onOpenLink = { link -> AedstRoutes.keyForLink(link)?.let(navigator::navigate) },
                onOpenPreferences = { navigator.navigate(NotificationPreferencesKey) },
            )
        }
        scope.entry<NotificationPreferencesKey> {
            NotificationPreferencesRoute(onBack = navigator::back)
        }
    }
}

/** Bell icon with the live unread count, for the app shell's bottom bar. */
@Composable
@NonRestartableComposable
fun NotificationsBadgedIcon(modifier: Modifier = Modifier) {
    UnreadBadgedIcon(modifier)
}

// Separate internal composable: the ViewModel is a default parameter (compose-rules ViewModelInjection) and, being
// internal, cannot appear in the public signature above.
@Composable
internal fun UnreadBadgedIcon(modifier: Modifier = Modifier, viewModel: UnreadBadgeViewModel = hiltViewModel()) {
    val unread by viewModel.unread.collectAsStateWithLifecycle()
    val description = pluralStringResource(R.plurals.notifications_unread_count, unread, unread)
    BadgedBox(badge = { if (unread > 0) AedstCountBadge(badgeText(unread)) }, modifier = modifier) {
        Icon(Icons.Filled.Notifications, contentDescription = description)
    }
}

private fun badgeText(unread: Int): String = if (unread > MAX_BADGE) "$MAX_BADGE+" else unread.toString()

private const val MAX_BADGE = 99

/**
 * Asks for POST_NOTIFICATIONS once per app session after sign-in (Android 13+; earlier versions grant it at
 * install). If the user declines, pushes are still registered and simply not shown; the inbox keeps working.
 */
@Composable
fun NotificationPermissionRequest() {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) return
    val context = LocalContext.current
    var hasAsked by rememberSaveable { mutableStateOf(false) }
    val launcher = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { }
    LaunchedEffect(Unit) {
        val granted = ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) ==
            PackageManager.PERMISSION_GRANTED
        if (!granted && !hasAsked) {
            hasAsked = true
            launcher.launch(Manifest.permission.POST_NOTIFICATIONS)
        }
    }
}
