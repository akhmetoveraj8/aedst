package com.aedst.feature.media.presentation.detail

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.aedst.core.common.AedstError
import com.aedst.core.common.Outcome
import com.aedst.core.media.MediaItem
import com.aedst.core.media.data.MediaRepository
import dagger.assisted.Assisted
import dagger.assisted.AssistedFactory
import dagger.assisted.AssistedInject
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.Job
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.receiveAsFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

data class MediaDetailState(
    val item: MediaItem? = null,
    val isLoading: Boolean = true,
    val isDeleting: Boolean = false,
    val error: AedstError? = null,
)

sealed interface MediaDetailIntent {
    data object Delete : MediaDetailIntent
    data object ErrorShown : MediaDetailIntent
}

sealed interface MediaDetailEffect {
    /** The media is gone on the server: leave the screen. */
    data object Deleted : MediaDetailEffect
}

@HiltViewModel(assistedFactory = MediaDetailViewModel.Factory::class)
internal class MediaDetailViewModel @AssistedInject constructor(
    @Assisted private val mediaId: String,
    private val repository: MediaRepository,
) : ViewModel() {

    private var loadJob: Job? = null

    private val mutableState = MutableStateFlow(MediaDetailState())
    val state: StateFlow<MediaDetailState> = mutableState.asStateFlow()

    private val effectChannel = Channel<MediaDetailEffect>(Channel.BUFFERED)
    val effects: Flow<MediaDetailEffect> = effectChannel.receiveAsFlow()

    init {
        load()
    }

    fun onIntent(intent: MediaDetailIntent) {
        when (intent) {
            MediaDetailIntent.Delete -> delete()
            MediaDetailIntent.ErrorShown -> mutableState.update { it.copy(error = null) }
        }
    }

    /** GetMedia returns fresh presigned URLs; never cache them across screens. */
    private fun load() {
        loadJob?.cancel()
        loadJob = viewModelScope.launch {
            val outcome = repository.get(mediaId)
            ensureActive()
            when (outcome) {
                is Outcome.Success -> mutableState.update { it.copy(item = outcome.value, isLoading = false) }
                is Outcome.Failure -> mutableState.update { it.copy(isLoading = false, error = outcome.error) }
            }
        }
    }

    private fun delete() {
        if (mutableState.value.isDeleting) return
        mutableState.update { it.copy(isDeleting = true) }
        viewModelScope.launch {
            when (val outcome = repository.delete(mediaId)) {
                is Outcome.Success -> effectChannel.send(MediaDetailEffect.Deleted)
                is Outcome.Failure -> mutableState.update { it.copy(isDeleting = false, error = outcome.error) }
            }
        }
    }

    /** The media id comes from the Navigation 3 key (`MediaDetailKey`), passed by `MediaDetailRoute`. */
    @AssistedFactory
    interface Factory {
        fun create(mediaId: String): MediaDetailViewModel
    }
}
