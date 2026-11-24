package com.aedst.feature.notifications.presentation

import androidx.lifecycle.ViewModel
import com.aedst.feature.notifications.data.UnreadCountStore
import dev.zacsweers.metro.AppScope
import dev.zacsweers.metro.ContributesIntoMap
import dev.zacsweers.metro.Inject
import dev.zacsweers.metrox.viewmodel.ViewModelKey
import kotlinx.coroutines.flow.StateFlow

/** Exposes the shared unread count to the app shell's navigation badge. */
@ViewModelKey
@ContributesIntoMap(AppScope::class)
@Inject
internal class UnreadBadgeViewModel(store: UnreadCountStore) : ViewModel() {
    val unread: StateFlow<Int> = store.count
}
