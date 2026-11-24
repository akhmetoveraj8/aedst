package com.aedst.feature.admin.presentation

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.aedst.core.common.AedstError
import com.aedst.core.common.Outcome
import com.aedst.core.common.SessionState
import com.aedst.feature.admin.domain.AdminOverview
import com.aedst.feature.admin.domain.AdminRepository
import com.aedst.feature.admin.domain.AdminTaskRow
import com.aedst.feature.admin.domain.AuditRow
import dev.zacsweers.metro.AppScope
import dev.zacsweers.metro.ContributesIntoMap
import dev.zacsweers.metro.Inject
import dev.zacsweers.metrox.viewmodel.ViewModelKey
import kotlinx.coroutines.Job
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

enum class AdminTab { OVERVIEW, TASKS, AUDIT }

data class AdminState(
    val tab: AdminTab = AdminTab.OVERVIEW,
    val query: String = "",
    val overview: AdminOverview? = null,
    val tasks: List<AdminTaskRow> = emptyList(),
    val audit: List<AuditRow> = emptyList(),
    val isLoading: Boolean = false,
    /** Task awaiting a delete reason (dialog open). */
    val pendingDelete: AdminTaskRow? = null,
    val error: AedstError? = null,
)

sealed interface AdminIntent {
    data class SelectTab(val tab: AdminTab) : AdminIntent
    data class QueryChanged(val query: String) : AdminIntent
    data object Search : AdminIntent
    data class RequestDelete(val task: AdminTaskRow) : AdminIntent
    data class ConfirmDelete(val reason: String) : AdminIntent
    data object DismissDelete : AdminIntent
    data object ErrorShown : AdminIntent
}

@ViewModelKey
@ContributesIntoMap(AppScope::class)
@Inject
internal class AdminViewModel(sessionState: SessionState, private val repository: AdminRepository) : ViewModel() {

    /** UI gate only — the server authorises every AdminService call independently. */
    val isAdmin: StateFlow<Boolean> = sessionState.currentUser
        .map { it?.isAdmin == true }
        .stateIn(viewModelScope, SharingStarted.Eagerly, sessionState.currentUser.value?.isAdmin == true)

    // One job per operation: switching tab or searching again cancels the load still running for the old tab/query,
    // so a slow answer for the previous tab can never overwrite the current one.
    private var loadJob: Job? = null

    private val mutableState = MutableStateFlow(AdminState())
    val state: StateFlow<AdminState> = mutableState.asStateFlow()

    init {
        if (isAdmin.value) load(AdminTab.OVERVIEW)
    }

    fun onIntent(intent: AdminIntent) {
        when (intent) {
            is AdminIntent.SelectTab -> {
                mutableState.update { it.copy(tab = intent.tab, query = "") }
                load(intent.tab)
            }
            is AdminIntent.QueryChanged -> mutableState.update { it.copy(query = intent.query) }
            AdminIntent.Search -> load(mutableState.value.tab)
            is AdminIntent.RequestDelete -> mutableState.update { it.copy(pendingDelete = intent.task) }
            is AdminIntent.ConfirmDelete -> deletePending(intent.reason)
            AdminIntent.DismissDelete -> mutableState.update { it.copy(pendingDelete = null) }
            AdminIntent.ErrorShown -> mutableState.update { it.copy(error = null) }
        }
    }

    private fun load(tab: AdminTab) {
        val query = mutableState.value.query
        loadJob?.cancel()
        mutableState.update { it.copy(isLoading = true) }
        loadJob = viewModelScope.launch {
            val failure: AedstError? = when (tab) {
                AdminTab.OVERVIEW -> repository.overview().applyTo(onSuccess = { v -> copy(overview = v) })
                AdminTab.TASKS -> repository.tasks(query).applyTo(onSuccess = { v -> copy(tasks = v.items) })
                AdminTab.AUDIT -> repository.auditLog().applyTo(onSuccess = { v -> copy(audit = v.items) })
            }
            mutableState.update { it.copy(isLoading = false, error = failure ?: it.error) }
        }
    }

    private fun deletePending(reason: String) {
        val task = mutableState.value.pendingDelete ?: return
        if (reason.trim().length < MIN_REASON_LENGTH) return
        mutableState.update { it.copy(pendingDelete = null, isLoading = true) }
        viewModelScope.launch {
            when (val outcome = repository.deleteTask(task.id, reason)) {
                is Outcome.Success -> mutableState.update {
                    it.copy(isLoading = false, tasks = it.tasks.filterNot { row -> row.id == task.id })
                }
                is Outcome.Failure -> mutableState.update { it.copy(isLoading = false, error = outcome.error) }
            }
        }
    }

    /** Applies a successful result to state; returns the error otherwise. */
    private suspend fun <T> Outcome<T>.applyTo(onSuccess: AdminState.(T) -> AdminState): AedstError? {
        currentCoroutineContext().ensureActive() // a superseded load must not write its answer
        return when (this) {
            is Outcome.Success -> {
                mutableState.update { it.onSuccess(value) }
                null
            }
            is Outcome.Failure -> error
        }
    }

    companion object {
        const val MIN_REASON_LENGTH = 3
    }
}
