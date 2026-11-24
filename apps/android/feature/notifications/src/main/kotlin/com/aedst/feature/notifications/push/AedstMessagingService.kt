package com.aedst.feature.notifications.push

import com.aedst.core.common.ApplicationScope
import com.aedst.core.common.SessionState
import com.aedst.core.common.graphAs
import com.aedst.feature.notifications.domain.NotificationsRepository
import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage
import dev.zacsweers.metro.AppScope
import dev.zacsweers.metro.ContributesTo
import dev.zacsweers.metro.Inject
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.launch

/**
 * FCM entry point. Runs only for foreground pushes and data-only messages (background "notification" messages are
 * shown by the system on the default channel; their `link` data arrives as an extra on the launch intent).
 * Work is handed to the application scope: FCM gives this service ~10–20 s, which is plenty for one RPC.
 *
 * The system instantiates the service, so it cannot be constructor-injected: it reads [PushServiceGraph] from the
 * application graph (Metro has no `@AndroidEntryPoint`) and delegates to [PushMessageHandler].
 */
internal class AedstMessagingService : FirebaseMessagingService() {

    private val handler by lazy { applicationContext.graphAs<PushServiceGraph>().pushMessageHandler }

    override fun onNewToken(token: String) = handler.onNewToken(token)

    override fun onMessageReceived(message: RemoteMessage) = handler.onMessageReceived(message)
}

/** What [AedstMessagingService] needs from the application graph. Public because Metro aggregates only public types. */
@ContributesTo(AppScope::class)
interface PushServiceGraph {
    val pushMessageHandler: PushMessageHandler
}

/** The service's logic, constructor-injected. Public only so [PushServiceGraph] can expose it; its API is internal. */
@Inject
class PushMessageHandler internal constructor(
    private val notifier: PushNotifier,
    private val registrar: PushRegistrar,
    private val sessionState: SessionState,
    private val repository: NotificationsRepository,
    @ApplicationScope private val scope: CoroutineScope,
) {
    internal fun onNewToken(token: String) {
        val userId = sessionState.currentUser.value?.id ?: return // registered on next sign-in instead
        scope.launch { registrar.sync(userId, token) }
    }

    internal fun onMessageReceived(message: RemoteMessage) {
        if (sessionState.isSignedIn.value != true) return // never show a previous account's pushes
        notifier.show(message.data, message.notification?.title, message.notification?.body)
        scope.launch { repository.unreadCount() } // refreshes the badge
    }
}
