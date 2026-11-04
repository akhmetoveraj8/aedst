package com.aedst.feature.notifications.presentation

import androidx.lifecycle.ViewModel
import com.aedst.feature.notifications.data.UnreadCountStore
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.StateFlow
import javax.inject.Inject

/** Exposes the shared unread count to the app shell's navigation badge. */
@HiltViewModel
internal class UnreadBadgeViewModel @Inject constructor(store: UnreadCountStore) : ViewModel() {
    val unread: StateFlow<Int> = store.count
}
