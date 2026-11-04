package com.aedst.feature.tasks.presentation.detail

import android.net.Uri
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.aedst.core.analytics.AnalyticsTracker
import com.aedst.core.common.AedstError
import com.aedst.core.common.Outcome
import com.aedst.core.media.MediaItem
import com.aedst.core.media.data.MediaRepository
import com.aedst.core.media.upload.MediaUploadScheduler
import com.aedst.core.media.upload.UploadProgress
import com.aedst.feature.tasks.domain.CompleteTaskResult
import com.aedst.feature.tasks.domain.CompleteTaskUseCase
import com.aedst.feature.tasks.domain.Task
import com.aedst.feature.tasks.domain.TaskRepository
import com.aedst.feature.tasks.domain.TaskStatus
import dagger.assisted.Assisted
import dagger.assisted.AssistedFactory
import dagger.assisted.AssistedInject
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.Job
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.receiveAsFlow
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

data class TaskDetailState(
    val task: Task? = null,
    val attachments: List<MediaItem> = emptyList(),
    val isLoading: Boolean = true,
    val isMutating: Boolean = false,
    /** Completed while offline: shown as done, waiting in the outbox until the network is back. */
    val isPendingSync: Boolean = false,
    val error: AedstError? = null,
)

sealed interface TaskDetailIntent {
    data object ToggleDone : TaskDetailIntent
    data object Delete : TaskDetailIntent
    data class Attach(val uris: List<Uri>) : TaskDetailIntent
    data class CancelUpload(val uploadId: String) : TaskDetailIntent
    data object Refresh : TaskDetailIntent
    data object ErrorShown : TaskDetailIntent
}

sealed interface TaskDetailEffect {
    data object Deleted : TaskDetailEffect

    /** The task was completed or reopened: a list showing it next to this detail (two-pane layouts) should reload. */
    data object Changed : TaskDetailEffect
}

/**
 * Task + its attachments (MediaService `ListMedia(task_id)`) + in-flight uploads (WorkManager). A finished upload
 * triggers an attachment reload, so a new file appears without pull-to-refresh.
 */
@HiltViewModel(assistedFactory = TaskDetailViewModel.Factory::class)
internal class TaskDetailViewModel @AssistedInject constructor(
    @Assisted private val taskId: String,
    private val tasks: TaskRepository,
    private val completeTask: CompleteTaskUseCase,
    private val media: MediaRepository,
    private val uploads: MediaUploadScheduler,
    private val analytics: AnalyticsTracker,
) : ViewModel() {

    private val mutableState = MutableStateFlow(TaskDetailState())
    val state: StateFlow<TaskDetailState> = mutableState.asStateFlow()

    val uploadsInFlight: StateFlow<List<UploadProgress>> = uploads.observe(taskId)
        .map { list -> list.filter { it.state != UploadProgress.State.CANCELLED } }
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(STOP_TIMEOUT_MS), emptyList())

    private val effectChannel = Channel<TaskDetailEffect>(Channel.BUFFERED)
    val effects: Flow<TaskDetailEffect> = effectChannel.receiveAsFlow()

    // One job per operation: a newer load cancels the older one, so a slow earlier answer never overwrites it.
    private var loadJob: Job? = null
    private var attachmentsJob: Job? = null

    init {
        load()
        viewModelScope.launch {
            uploads.observe(taskId)
                .map { list -> list.count { it.state == UploadProgress.State.DONE } }
                .distinctUntilChanged()
                .collect { done -> if (done > 0) refreshAttachments() }
        }
    }

    fun onIntent(intent: TaskDetailIntent) {
        when (intent) {
            TaskDetailIntent.ToggleDone -> toggleDone()
            TaskDetailIntent.Delete -> delete()
            is TaskDetailIntent.Attach -> {
                intent.uris.forEach { uploads.enqueue(it, taskId) }
                analytics.logEvent("task_attachment_added", mapOf("count" to intent.uris.size))
            }
            is TaskDetailIntent.CancelUpload -> uploads.cancel(intent.uploadId)
            TaskDetailIntent.Refresh -> load()
            TaskDetailIntent.ErrorShown -> mutableState.update { it.copy(error = null) }
        }
    }

    private fun load() {
        loadJob?.cancel()
        mutableState.update { it.copy(isLoading = true) }
        loadJob = viewModelScope.launch {
            val outcome = tasks.get(taskId)
            ensureActive()
            when (outcome) {
                is Outcome.Success -> mutableState.update {
                    it.copy(task = outcome.value, isLoading = false, isPendingSync = false)
                }
                is Outcome.Failure -> mutableState.update { it.copy(isLoading = false, error = outcome.error) }
            }
            refreshAttachments()
        }
    }

    private fun refreshAttachments() {
        attachmentsJob?.cancel()
        attachmentsJob = viewModelScope.launch {
            val outcome = media.list(taskId = taskId)
            ensureActive()
            when (outcome) {
                is Outcome.Success -> mutableState.update { it.copy(attachments = outcome.value.items) }
                is Outcome.Failure -> mutableState.update { it.copy(error = outcome.error) }
            }
        }
    }

    private fun toggleDone() {
        val task = mutableState.value.task ?: return
        // A queued completion is still on its way: reopening now would be overtaken by it.
        if (mutableState.value.isMutating || mutableState.value.isPendingSync) return
        mutableState.update { it.copy(isMutating = true) }
        viewModelScope.launch {
            if (task.isDone) {
                onChanged(tasks.reopen(task.id))
            } else {
                when (val outcome = completeTask(task.id)) {
                    is Outcome.Success -> when (val result = outcome.value) {
                        is CompleteTaskResult.Completed -> onChanged(Outcome.Success(result.task))
                        CompleteTaskResult.Queued -> onCompleteQueued(task)
                    }
                    is Outcome.Failure -> onChanged(outcome)
                }
            }
        }
    }

    private suspend fun onChanged(outcome: Outcome<Task>) {
        when (outcome) {
            is Outcome.Success -> {
                if (outcome.value.isDone) analytics.logEvent("task_completed")
                mutableState.update { it.copy(task = outcome.value, isMutating = false) }
                effectChannel.send(TaskDetailEffect.Changed)
            }
            is Outcome.Failure -> mutableState.update { it.copy(isMutating = false, error = outcome.error) }
        }
    }

    /** Optimistic: the task reads as done now; the outbox confirms it with the server later. */
    private fun onCompleteQueued(task: Task) {
        analytics.logEvent("task_completed")
        mutableState.update {
            it.copy(task = task.copy(status = TaskStatus.DONE), isMutating = false, isPendingSync = true)
        }
    }

    private fun delete() {
        if (mutableState.value.isMutating) return
        mutableState.update { it.copy(isMutating = true) }
        viewModelScope.launch {
            when (val outcome = tasks.delete(taskId)) {
                is Outcome.Success -> effectChannel.send(TaskDetailEffect.Deleted)
                is Outcome.Failure -> mutableState.update { it.copy(isMutating = false, error = outcome.error) }
            }
        }
    }

    /** The task id comes from the Navigation 3 key (`TaskDetailKey`), passed by `TaskDetailRoute`. */
    @AssistedFactory
    interface Factory {
        fun create(taskId: String): TaskDetailViewModel
    }

    private companion object {
        const val STOP_TIMEOUT_MS = 5_000L
    }
}
