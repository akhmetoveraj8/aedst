package com.aedst.feature.media.presentation.library

import android.net.Uri
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.aedst.core.common.AedstError
import com.aedst.core.common.Outcome
import com.aedst.core.media.MediaItem
import com.aedst.core.media.data.MediaRepository
import com.aedst.core.media.upload.MediaUploadScheduler
import com.aedst.core.media.upload.UploadProgress
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.Job
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.drop
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import javax.inject.Inject

data class MediaLibraryState(
    val items: List<MediaItem> = emptyList(),
    val nextPageToken: String? = null,
    val isLoading: Boolean = true,
    val isLoadingMore: Boolean = false,
    val error: AedstError? = null,
)

sealed interface MediaLibraryIntent {
    /** Reload the first page. The screen sends it on every start, so the ViewModel does not load by itself. */
    data object Refresh : MediaLibraryIntent
    data object LoadMore : MediaLibraryIntent
    data class Upload(val uris: List<Uri>) : MediaLibraryIntent
    data class CancelUpload(val uploadId: String) : MediaLibraryIntent
    data object ErrorShown : MediaLibraryIntent
}

@HiltViewModel
internal class MediaLibraryViewModel @Inject constructor(
    private val repository: MediaRepository,
    private val uploads: MediaUploadScheduler,
) : ViewModel() {

    // One job per operation: a newer request cancels the older one, so a slow earlier page never overwrites it.
    private var refreshJob: Job? = null
    private var loadMoreJob: Job? = null

    private val mutableState = MutableStateFlow(MediaLibraryState())
    val state: StateFlow<MediaLibraryState> = mutableState.asStateFlow()

    /** Uploads not attached to a task show here too (all uploads), minus finished/cancelled ones. */
    val activeUploads: StateFlow<List<UploadProgress>> = uploads.observe()
        .map { list ->
            list.filter { it.state != UploadProgress.State.DONE && it.state != UploadProgress.State.CANCELLED }
        }
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(STOP_TIMEOUT_MS), emptyList())

    init {
        // A newly finished upload adds a file: reload. The first value is the state at creation, not a change; the
        // screen's own start-up refresh covers it (loading here as well would be a duplicate request).
        viewModelScope.launch {
            uploads.observe()
                .map { list -> list.count { it.state == UploadProgress.State.DONE } }
                .distinctUntilChanged()
                .drop(1)
                .collect { refresh() }
        }
    }

    fun onIntent(intent: MediaLibraryIntent) {
        when (intent) {
            MediaLibraryIntent.Refresh -> refresh()
            MediaLibraryIntent.LoadMore -> loadMore()
            is MediaLibraryIntent.Upload -> intent.uris.forEach { uploads.enqueue(it) }
            is MediaLibraryIntent.CancelUpload -> uploads.cancel(intent.uploadId)
            MediaLibraryIntent.ErrorShown -> mutableState.update { it.copy(error = null) }
        }
    }

    private fun refresh() {
        loadMoreJob?.cancel()
        refreshJob?.cancel()
        mutableState.update { it.copy(isLoading = true, isLoadingMore = false) }
        refreshJob = viewModelScope.launch {
            val outcome = repository.list(pageToken = null)
            ensureActive() // a repository that finished anyway must not apply a superseded answer
            when (outcome) {
                is Outcome.Success -> mutableState.update {
                    it.copy(items = outcome.value.items, nextPageToken = outcome.value.nextPageToken, isLoading = false)
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
            val outcome = repository.list(pageToken = token)
            ensureActive()
            when (outcome) {
                is Outcome.Success -> mutableState.update {
                    it.copy(
                        items = it.items + outcome.value.items,
                        nextPageToken = outcome.value.nextPageToken,
                        isLoadingMore = false,
                    )
                }
                is Outcome.Failure -> mutableState.update { it.copy(isLoadingMore = false, error = outcome.error) }
            }
        }
    }

    private companion object {
        const val STOP_TIMEOUT_MS = 5_000L
    }
}
