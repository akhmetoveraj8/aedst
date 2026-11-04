package com.aedst.feature.tasks.presentation.create

import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.aedst.core.analytics.AnalyticsTracker
import com.aedst.core.common.AedstError
import com.aedst.core.common.Outcome
import com.aedst.feature.tasks.domain.CreateTaskResult
import com.aedst.feature.tasks.domain.CreateTaskUseCase
import com.aedst.feature.tasks.domain.NewTask
import com.aedst.feature.tasks.domain.TaskPriority
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.receiveAsFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import javax.inject.Inject

data class TaskCreateState(
    val title: String = "",
    val description: String = "",
    val priority: TaskPriority = TaskPriority.MEDIUM,
    val isSaving: Boolean = false,
    val isTitleInvalid: Boolean = false,
    /** The last submit was saved on the device and waits for the network; the form is empty again. */
    val isQueued: Boolean = false,
    val error: AedstError? = null,
)

sealed interface TaskCreateIntent {
    data class TitleChanged(val value: String) : TaskCreateIntent
    data class DescriptionChanged(val value: String) : TaskCreateIntent
    data class PriorityChanged(val value: TaskPriority) : TaskCreateIntent
    data object Submit : TaskCreateIntent
    data object ErrorShown : TaskCreateIntent
}

sealed interface TaskCreateEffect {
    /** The task exists on the server: navigate to its detail screen. */
    data class Created(val taskId: String) : TaskCreateEffect
}

/**
 * The form draft (title, description, priority) lives in [SavedStateHandle], so the system killing the app's process
 * while the user is in another app does not lose what was typed.
 */
@HiltViewModel
internal class TaskCreateViewModel @Inject constructor(
    private val savedState: SavedStateHandle,
    private val createTask: CreateTaskUseCase,
    private val analytics: AnalyticsTracker,
) : ViewModel() {

    private val mutableState = MutableStateFlow(restoreDraft())
    val state: StateFlow<TaskCreateState> = mutableState.asStateFlow()

    private val effectChannel = Channel<TaskCreateEffect>(Channel.BUFFERED)
    val effects: Flow<TaskCreateEffect> = effectChannel.receiveAsFlow()

    fun onIntent(intent: TaskCreateIntent) {
        when (intent) {
            is TaskCreateIntent.TitleChanged -> editDraft {
                copy(title = intent.value.take(CreateTaskUseCase.MAX_TITLE_LENGTH), isTitleInvalid = false)
            }
            is TaskCreateIntent.DescriptionChanged -> editDraft {
                copy(description = intent.value.take(CreateTaskUseCase.MAX_DESCRIPTION_LENGTH))
            }
            is TaskCreateIntent.PriorityChanged -> editDraft { copy(priority = intent.value) }
            TaskCreateIntent.Submit -> submit()
            TaskCreateIntent.ErrorShown -> mutableState.update { it.copy(error = null) }
        }
    }

    private fun submit() {
        val current = mutableState.value
        if (current.isSaving) return
        mutableState.update { it.copy(isSaving = true, isQueued = false) }
        viewModelScope.launch {
            val outcome = createTask(NewTask(current.title, current.description, current.priority, null))
            when (outcome) {
                is Outcome.Success -> onSaved(outcome.value, current.priority)
                is Outcome.Failure -> mutableState.update { it.failed(outcome.error) }
            }
        }
    }

    private suspend fun onSaved(result: CreateTaskResult, priority: TaskPriority) {
        analytics.logEvent("task_created", mapOf("priority" to priority.name.lowercase()))
        when (result) {
            is CreateTaskResult.Created -> {
                mutableState.update { it.copy(isSaving = false) }
                effectChannel.send(TaskCreateEffect.Created(result.task.id))
            }
            // Offline: the outbox owns the write now. Start a fresh form instead of leaving the sent text behind.
            CreateTaskResult.Queued -> {
                clearDraft()
                mutableState.update { TaskCreateState(priority = it.priority, isQueued = true) }
            }
        }
    }

    private fun editDraft(change: TaskCreateState.() -> TaskCreateState) {
        mutableState.update { it.change().copy(isQueued = false) }
        val draft = mutableState.value
        savedState[KEY_TITLE] = draft.title
        savedState[KEY_DESCRIPTION] = draft.description
        savedState[KEY_PRIORITY] = draft.priority.name
    }

    private fun clearDraft() {
        savedState.remove<String>(KEY_TITLE)
        savedState.remove<String>(KEY_DESCRIPTION)
    }

    private fun restoreDraft(): TaskCreateState = TaskCreateState(
        title = savedState.get<String>(KEY_TITLE).orEmpty(),
        description = savedState.get<String>(KEY_DESCRIPTION).orEmpty(),
        priority = savedState.get<String>(KEY_PRIORITY)
            ?.let { name -> TaskPriority.selectable.firstOrNull { it.name == name } }
            ?: TaskPriority.MEDIUM,
    )

    /** A title the use case rejected is an inline field error; anything else is shown as a message. */
    private fun TaskCreateState.failed(error: AedstError): TaskCreateState =
        if (error is AedstError.InvalidInput && error.message == CreateTaskUseCase.FIELD_TITLE) {
            copy(isSaving = false, isTitleInvalid = true)
        } else {
            copy(isSaving = false, error = error)
        }

    private companion object {
        const val KEY_TITLE = "draft_title"
        const val KEY_DESCRIPTION = "draft_description"
        const val KEY_PRIORITY = "draft_priority"
    }
}
