package com.aedst.feature.notifications.push

import com.aedst.core.common.AppInitializer
import com.aedst.core.common.ApplicationScope
import com.aedst.core.common.SessionState
import com.aedst.core.common.SignOutHook
import com.aedst.feature.notifications.data.UnreadCountStore
import com.aedst.feature.notifications.domain.NotificationsRepository
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.launch
import javax.inject.Inject

/** Creates channels, then on every sign-in (and app start while signed in) registers push and loads the badge. */
internal class PushInitializer @Inject constructor(
    private val notifier: PushNotifier,
    private val registrar: PushRegistrar,
    private val repository: NotificationsRepository,
    private val unreadCount: UnreadCountStore,
    private val sessionState: SessionState,
    @ApplicationScope private val scope: CoroutineScope,
) : AppInitializer {

    override fun initialize() {
        notifier.createChannels()
        scope.launch {
            sessionState.currentUser.map { it?.id }.distinctUntilChanged().collect { userId ->
                if (userId == null) {
                    unreadCount.set(0)
                } else {
                    launch { registrar.sync(userId) }
                    repository.unreadCount()
                }
            }
        }
    }
}

/** Unregisters this device while the session (bearer token) is still valid. */
class PushSignOutHook @Inject constructor(private val registrar: PushRegistrar) : SignOutHook {
    override suspend fun beforeSignOut() = registrar.unregister()
}
