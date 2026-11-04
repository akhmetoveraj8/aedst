package com.aedst.feature.tasks.presentation.detail

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.hilt.lifecycle.viewmodel.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.aedst.core.media.ImagePreset
import com.aedst.core.media.MediaItem
import com.aedst.core.media.ui.MediaThumbnail
import com.aedst.core.media.ui.UploadProgressRow
import com.aedst.core.media.ui.rememberMediaPicker
import com.aedst.core.media.upload.UploadProgress
import com.aedst.core.ui.adaptive.AedstAdaptiveContent
import com.aedst.core.ui.adaptive.AedstContentWidth
import com.aedst.core.ui.adaptive.AedstWindowSizePreviews
import com.aedst.core.ui.components.AedstAlert
import com.aedst.core.ui.components.AedstAlertVariant
import com.aedst.core.ui.components.AedstButton
import com.aedst.core.ui.components.AedstButtonVariant
import com.aedst.core.ui.components.AedstErrorSnackbarEffect
import com.aedst.core.ui.components.AedstIconButton
import com.aedst.core.ui.components.AedstSnackbarHost
import com.aedst.core.ui.components.AedstTopAppBar
import com.aedst.core.ui.components.FullScreenLoading
import com.aedst.core.ui.theme.AedstShapesScale
import com.aedst.core.ui.theme.AedstSpacing
import com.aedst.core.ui.theme.AedstTheme
import com.aedst.feature.tasks.R
import com.aedst.feature.tasks.domain.Task
import com.aedst.feature.tasks.domain.TaskPriority
import com.aedst.feature.tasks.domain.TaskStatus
import com.aedst.feature.tasks.presentation.TaskStatusBadge
import com.aedst.feature.tasks.presentation.formatDate
import com.aedst.feature.tasks.presentation.list.previewTask
import com.aedst.feature.tasks.presentation.priorityLabel

@Composable
internal fun TaskDetailRoute(
    taskId: String,
    onBack: () -> Unit,
    onOpenMedia: (String) -> Unit,
    onTaskChanged: () -> Unit = {},
    isSinglePane: Boolean = true,
    // Keyed by the task id: the list-detail layout swaps the shown task inside one navigation entry, and every task
    // needs its own ViewModel (the default key would hand back the first one).
    viewModel: TaskDetailViewModel = hiltViewModel<TaskDetailViewModel, TaskDetailViewModel.Factory>(
        key = taskId,
        creationCallback = { factory -> factory.create(taskId) },
    ),
) {
    val state by viewModel.state.collectAsStateWithLifecycle()
    val uploads by viewModel.uploadsInFlight.collectAsStateWithLifecycle()
    val currentOnBack by rememberUpdatedState(onBack)
    val currentOnTaskChanged by rememberUpdatedState(onTaskChanged)
    LaunchedEffect(viewModel) {
        viewModel.effects.collect { effect ->
            when (effect) {
                TaskDetailEffect.Deleted -> {
                    currentOnTaskChanged()
                    currentOnBack()
                }
                TaskDetailEffect.Changed -> currentOnTaskChanged()
            }
        }
    }
    TaskDetailScreen(
        state = state,
        uploads = uploads,
        onIntent = viewModel::onIntent,
        onBack = onBack,
        onOpenMedia = onOpenMedia,
        isSinglePane = isSinglePane,
    )
}

/**
 * @param isSinglePane `true` when this screen fills the window (a pushed detail): back arrow and a centered reading
 *   column. In the two-pane list-detail layout it is `false`: the list stays visible, there is nothing to go back to
 *   and the pane scaffold already positions the pane around a fold.
 */
@Composable
internal fun TaskDetailScreen(
    state: TaskDetailState,
    uploads: List<UploadProgress>,
    onIntent: (TaskDetailIntent) -> Unit,
    onBack: () -> Unit,
    onOpenMedia: (String) -> Unit,
    isSinglePane: Boolean = true,
) {
    val snackbarHostState = remember { SnackbarHostState() }
    AedstErrorSnackbarEffect(state.error, snackbarHostState, onShown = { onIntent(TaskDetailIntent.ErrorShown) })
    val pickMedia = rememberMediaPicker { uris -> onIntent(TaskDetailIntent.Attach(uris)) }

    Scaffold(
        topBar = {
            AedstTopAppBar(
                title = state.task?.title.orEmpty(),
                navigationIcon = if (isSinglePane) backButton(onBack) else null,
                actions = {
                    if (state.task != null) {
                        AedstIconButton(
                            onClick = { onIntent(TaskDetailIntent.Delete) },
                            contentDescription = stringResource(R.string.tasks_delete),
                            enabled = !state.isMutating,
                        ) {
                            Icon(Icons.Filled.Delete, contentDescription = null)
                        }
                    }
                },
            )
        },
        snackbarHost = { AedstSnackbarHost(snackbarHostState) },
    ) { padding ->
        val task = state.task
        if (task == null) {
            if (state.isLoading) FullScreenLoading(Modifier.padding(padding))
            return@Scaffold
        }
        if (isSinglePane) {
            AedstAdaptiveContent(modifier = Modifier.padding(padding), maxWidth = AedstContentWidth.reading) {
                TaskDetailBody(task, state, uploads, onIntent, pickMedia, onOpenMedia)
            }
        } else {
            TaskDetailBody(task, state, uploads, onIntent, pickMedia, onOpenMedia, Modifier.padding(padding))
        }
    }
}

private fun backButton(onBack: () -> Unit): @Composable () -> Unit = {
    AedstIconButton(
        onClick = onBack,
        contentDescription = stringResource(R.string.tasks_back),
    ) {
        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = null)
    }
}

@Composable
private fun TaskDetailBody(
    task: Task,
    state: TaskDetailState,
    uploads: List<UploadProgress>,
    onIntent: (TaskDetailIntent) -> Unit,
    onAttach: () -> Unit,
    onOpenMedia: (String) -> Unit,
    modifier: Modifier = Modifier,
) {
    Column(
        modifier = modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(AedstSpacing.lg),
        verticalArrangement = Arrangement.spacedBy(AedstSpacing.lg),
    ) {
        TaskSummary(task)
        AedstButton(
            text = stringResource(if (task.isDone) R.string.tasks_reopen else R.string.tasks_complete),
            onClick = { onIntent(TaskDetailIntent.ToggleDone) },
            loading = state.isMutating,
            variant = if (task.isDone) AedstButtonVariant.OUTLINE else AedstButtonVariant.DEFAULT,
            modifier = Modifier.fillMaxWidth(),
        )
        if (state.isPendingSync) {
            AedstAlert(
                title = stringResource(R.string.tasks_pending_sync_title),
                description = stringResource(R.string.tasks_pending_sync),
                variant = AedstAlertVariant.INFO,
            )
        }
        Attachments(
            attachments = state.attachments,
            uploads = uploads,
            onAttach = onAttach,
            onOpenMedia = onOpenMedia,
            onCancelUpload = { onIntent(TaskDetailIntent.CancelUpload(it)) },
        )
    }
}

@Composable
private fun TaskSummary(task: Task) {
    Column(verticalArrangement = Arrangement.spacedBy(AedstSpacing.sm)) {
        Row(
            horizontalArrangement = Arrangement.spacedBy(AedstSpacing.sm),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            TaskStatusBadge(task.status)
            Text(priorityLabel(task.priority), style = MaterialTheme.typography.labelLarge)
        }
        task.dueDate?.let {
            Text(stringResource(R.string.tasks_due, it.formatDate()), style = MaterialTheme.typography.bodyMedium)
        }
        if (task.description.isNotBlank()) {
            Text(task.description, style = MaterialTheme.typography.bodyLarge)
        }
    }
}

@Composable
private fun Attachments(
    attachments: List<MediaItem>,
    uploads: List<UploadProgress>,
    onAttach: () -> Unit,
    onOpenMedia: (String) -> Unit,
    onCancelUpload: (String) -> Unit,
) {
    Column(verticalArrangement = Arrangement.spacedBy(AedstSpacing.sm)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(
                text = stringResource(R.string.tasks_attachments),
                style = MaterialTheme.typography.titleMedium,
                modifier = Modifier.weight(1f),
            )
            AedstButton(
                text = stringResource(R.string.tasks_attach),
                onClick = onAttach,
                variant = AedstButtonVariant.GHOST,
            )
        }
        if (attachments.isEmpty() && uploads.isEmpty()) {
            Text(stringResource(R.string.tasks_no_attachments), style = MaterialTheme.typography.bodyMedium)
        }
        if (attachments.isNotEmpty()) {
            LazyRow(horizontalArrangement = Arrangement.spacedBy(AedstSpacing.sm)) {
                items(attachments, key = MediaItem::id) { item ->
                    MediaThumbnail(
                        item = item,
                        contentDescription = item.filename,
                        preset = ImagePreset.AVATAR_256,
                        modifier = Modifier
                            .size(96.dp) // allow-dp: thumbnail size, not a spacing step
                            .clip(AedstShapesScale.medium)
                            .clickable { onOpenMedia(item.id) },
                    )
                }
            }
        }
        uploads.filter { it.state != UploadProgress.State.DONE }.forEach { upload ->
            UploadProgressRow(
                upload = upload,
                onCancel = { onCancelUpload(upload.uploadId) },
            )
        }
    }
}

@AedstWindowSizePreviews
@Composable
private fun TaskDetailScreenPreview() {
    val task = previewTask("1", "Write the quarterly report", TaskStatus.IN_PROGRESS, TaskPriority.HIGH)
    AedstTheme {
        TaskDetailScreen(
            state = TaskDetailState(task = task, isLoading = false),
            uploads = emptyList(),
            onIntent = {},
            onBack = {},
            onOpenMedia = {},
        )
    }
}
