package com.aedst.feature.tasks.presentation.list

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.aedst.core.common.AedstError
import com.aedst.core.common.Outcome
import com.aedst.feature.tasks.domain.Task
import com.aedst.feature.tasks.domain.TaskRepository
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.Job
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import javax.inject.Inject

data class TaskListState(
    val tasks: List<Task> = emptyList(),
    val totalCount: Int = 0,
    val nextPageToken: String? = null,
    val isLoading: Boolean = true,
    val isLoadingMore: Boolean = false,
    /** Transient error, shown once as a snackbar. */
    val error: AedstError? = null,
) {
    val isEmpty: Boolean get() = !isLoading && tasks.isEmpty()
    val canLoadMore: Boolean get() = nextPageToken != null && !isLoadingMore
}

sealed interface TaskListIntent {
    data object Refresh : TaskListIntent
    data object LoadMore : TaskListIntent
    data object ErrorShown : TaskListIntent
}

@HiltViewModel
internal class TaskListViewModel @Inject constructor(private val repository: TaskRepository) : ViewModel() {

    private val mutableState = MutableStateFlow(TaskListState())
    val state: StateFlow<TaskListState> = mutableState.asStateFlow()

    // One job per operation: a newer request of the same kind cancels the older one, so a slow earlier response can
    // never overwrite a later one (pull-to-refresh twice, refresh while a next page is loading).
    private var refreshJob: Job? = null
    private var loadMoreJob: Job? = null

    fun onIntent(intent: TaskListIntent) {
        when (intent) {
            TaskListIntent.Refresh -> refresh()
            TaskListIntent.LoadMore -> loadMore()
            TaskListIntent.ErrorShown -> mutableState.update { it.copy(error = null) }
        }
    }

    private fun refresh() {
        loadMoreJob?.cancel()
        refreshJob?.cancel()
        mutableState.update { it.copy(isLoading = true, isLoadingMore = false) }
        refreshJob = viewModelScope.launch {
            val outcome = repository.list()
            ensureActive() // a repository that finished anyway must not apply a superseded answer
            when (outcome) {
                is Outcome.Success -> mutableState.update {
                    it.copy(
                        tasks = outcome.value.tasks,
                        totalCount = outcome.value.totalCount,
                        nextPageToken = outcome.value.nextPageToken,
                        isLoading = false,
                    )
                }
                is Outcome.Failure -> mutableState.update { it.copy(isLoading = false, error = outcome.error) }
            }
        }
    }

    private fun loadMore() {
        val token = mutableState.value.nextPageToken ?: return
        // A page requested before the list was reloaded would be appended to the wrong list.
        if (mutableState.value.isLoadingMore || refreshJob?.isActive == true) return
        mutableState.update { it.copy(isLoadingMore = true) }
        loadMoreJob = viewModelScope.launch {
            val outcome = repository.list(token)
            ensureActive()
            when (outcome) {
                is Outcome.Success -> mutableState.update {
                    it.copy(
                        tasks = it.tasks + outcome.value.tasks,
                        nextPageToken = outcome.value.nextPageToken,
                        isLoadingMore = false,
                    )
                }
                is Outcome.Failure -> mutableState.update { it.copy(isLoadingMore = false, error = outcome.error) }
            }
        }
    }
}
