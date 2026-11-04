package com.aedst.feature.notifications.data

import com.aedst.core.common.SignOutHook
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Process-wide unread count behind the badge. Refreshed from the server on sign-in, on every push received and
 * after inbox actions; updated locally (optimistically) by mark-read so the badge reacts instantly.
 */
@Singleton
class UnreadCountStore @Inject constructor() {
    private val mutableCount = MutableStateFlow(0)
    val count: StateFlow<Int> = mutableCount.asStateFlow()

    fun set(value: Int) {
        mutableCount.value = value.coerceAtLeast(0)
    }

    fun decrementBy(value: Int) {
        mutableCount.update { (it - value).coerceAtLeast(0) }
    }
}

/** The badge counts the signed-in user's unread items: it must read zero for whoever signs in next. */
internal class UnreadCountSignOutHook @Inject constructor(private val store: UnreadCountStore) : SignOutHook {
    override suspend fun onSessionEnded() = store.set(0)
}
