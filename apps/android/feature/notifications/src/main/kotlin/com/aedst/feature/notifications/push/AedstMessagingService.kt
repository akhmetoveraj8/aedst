package com.aedst.feature.notifications.push

import com.aedst.core.common.ApplicationScope
import com.aedst.core.common.SessionState
import com.aedst.feature.notifications.domain.NotificationsRepository
import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage
import dagger.hilt.android.AndroidEntryPoint
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.launch
import javax.inject.Inject

/**
 * FCM entry point. Runs only for foreground pushes and data-only messages (background "notification" messages are
 * shown by the system on the default channel; their `link` data arrives as an extra on the launch intent).
 * Work is handed to the application scope: FCM gives this service ~10–20 s, which is plenty for one RPC.
 */
@AndroidEntryPoint
internal class AedstMessagingService : FirebaseMessagingService() {

    @Inject lateinit var notifier: PushNotifier

    @Inject lateinit var registrar: PushRegistrar

    @Inject lateinit var sessionState: SessionState

    @Inject lateinit var repository: NotificationsRepository

    @Inject @ApplicationScope
    lateinit var scope: CoroutineScope

    override fun onNewToken(token: String) {
        val userId = sessionState.currentUser.value?.id ?: return // registered on next sign-in instead
        scope.launch { registrar.sync(userId, token) }
    }

    override fun onMessageReceived(message: RemoteMessage) {
        if (sessionState.isSignedIn.value != true) return // never show a previous account's pushes
        notifier.show(message.data, message.notification?.title, message.notification?.body)
        scope.launch { repository.unreadCount() } // refreshes the badge
    }
}
