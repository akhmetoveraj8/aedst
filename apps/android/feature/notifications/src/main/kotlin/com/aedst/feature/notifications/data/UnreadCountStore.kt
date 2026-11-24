package com.aedst.feature.notifications.data

import com.aedst.core.common.SignOutHook
import dev.zacsweers.metro.AppScope
import dev.zacsweers.metro.ContributesIntoSet
import dev.zacsweers.metro.Inject
import dev.zacsweers.metro.SingleIn
import dev.zacsweers.metro.binding
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update

/**
 * Process-wide unread count behind the badge. Refreshed from the server on sign-in, on every push received and
 * after inbox actions; updated locally (optimistically) by mark-read so the badge reacts instantly.
 */
@SingleIn(AppScope::class)
@Inject
class UnreadCountStore {
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
@ContributesIntoSet(AppScope::class, binding<SignOutHook>())
@Inject
internal class UnreadCountSignOutHook(private val store: UnreadCountStore) : SignOutHook {
    override suspend fun onSessionEnded() = store.set(0)
}
