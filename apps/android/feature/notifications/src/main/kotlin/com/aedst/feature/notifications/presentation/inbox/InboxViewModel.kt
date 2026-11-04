package com.aedst.feature.notifications.presentation.inbox

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.aedst.core.common.AedstError
import com.aedst.core.common.Outcome
import com.aedst.feature.notifications.domain.InboxNotification
import com.aedst.feature.notifications.domain.NotificationsRepository
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.Job
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import java.time.Instant
import javax.inject.Inject

data class InboxState(
    val notifications: List<InboxNotification> = emptyList(),
    val nextPageToken: String? = null,
    val isLoading: Boolean = true,
    val error: AedstError? = null,
) {
    val hasUnread: Boolean get() = notifications.any(InboxNotification::isUnread)
}

sealed interface InboxIntent {
    data object Refresh : InboxIntent
    data object LoadMore : InboxIntent
    data class Open(val notification: InboxNotification) : InboxIntent
    data object MarkAllRead : InboxIntent
    data object ErrorShown : InboxIntent
}

@HiltViewModel
internal class InboxViewModel @Inject constructor(private val repository: NotificationsRepository) : ViewModel() {

    // One job per operation: a newer request of the same kind cancels the older one, so a slow earlier answer never
    // overwrites a later one (pull-to-refresh twice, refresh while a next page is loading).
    private var refreshJob: Job? = null
    private var loadMoreJob: Job? = null

    private val mutableState = MutableStateFlow(InboxState())
    val state: StateFlow<InboxState> = mutableState.asStateFlow()

    fun onIntent(intent: InboxIntent) {
        when (intent) {
            InboxIntent.Refresh -> refresh()
            InboxIntent.LoadMore -> mutableState.value.nextPageToken?.let(::loadMore)
            is InboxIntent.Open -> markRead(intent.notification)
            InboxIntent.MarkAllRead -> markAllRead()
            InboxIntent.ErrorShown -> mutableState.update { it.copy(error = null) }
        }
    }

    private fun refresh() {
        loadMoreJob?.cancel()
        refreshJob?.cancel()
        mutableState.update { it.copy(isLoading = true) }
        refreshJob = viewModelScope.launch {
            val outcome = repository.list(pageToken = null)
            ensureActive() // a repository that finished anyway must not apply a superseded answer
            when (outcome) {
                is Outcome.Success -> mutableState.update {
                    it.copy(
                        notifications = outcome.value.notifications,
                        nextPageToken = outcome.value.nextPageToken,
                        isLoading = false,
                    )
                }
                is Outcome.Failure -> mutableState.update { it.copy(isLoading = false, error = outcome.error) }
            }
            repository.unreadCount()
        }
    }

    private fun loadMore(pageToken: String) {
        // A page requested before the inbox was reloaded would be appended to the wrong list.
        if (refreshJob?.isActive == true) return
        loadMoreJob?.cancel()
        mutableState.update { it.copy(isLoading = true) }
        loadMoreJob = viewModelScope.launch {
            val outcome = repository.list(pageToken = pageToken)
            ensureActive()
            when (outcome) {
                is Outcome.Success -> mutableState.update {
                    it.copy(
                        notifications = it.notifications + outcome.value.notifications,
                        nextPageToken = outcome.value.nextPageToken,
                        isLoading = false,
                    )
                }
                is Outcome.Failure -> mutableState.update { it.copy(isLoading = false, error = outcome.error) }
            }
        }
    }

    /** Optimistic: the row turns read immediately; the badge follows via the shared unread store. */
    private fun markRead(notification: InboxNotification) {
        if (!notification.isUnread) return
        val now = Instant.now()
        mutableState.update { state ->
            state.copy(
                notifications = state.notifications.map { if (it.id == notification.id) it.copy(readAt = now) else it },
            )
        }
        viewModelScope.launch {
            (repository.markRead(listOf(notification.id)) as? Outcome.Failure)?.let { failure ->
                mutableState.update { it.copy(error = failure.error) }
            }
        }
    }

    private fun markAllRead() {
        val now = Instant.now()
        mutableState.update { state ->
            state.copy(notifications = state.notifications.map { it.copy(readAt = it.readAt ?: now) })
        }
        viewModelScope.launch {
            (repository.markAllRead() as? Outcome.Failure)?.let { failure ->
                mutableState.update { it.copy(error = failure.error) }
            }
        }
    }
}
