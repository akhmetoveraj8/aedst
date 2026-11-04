package com.aedst.feature.tasks.presentation.create

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
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
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.hilt.lifecycle.viewmodel.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.aedst.core.ui.adaptive.AedstAdaptiveContent
import com.aedst.core.ui.adaptive.AedstContentWidth
import com.aedst.core.ui.adaptive.AedstWindowSizePreviews
import com.aedst.core.ui.components.AedstAlert
import com.aedst.core.ui.components.AedstAlertVariant
import com.aedst.core.ui.components.AedstButton
import com.aedst.core.ui.components.AedstErrorSnackbarEffect
import com.aedst.core.ui.components.AedstFilterChip
import com.aedst.core.ui.components.AedstIconButton
import com.aedst.core.ui.components.AedstSnackbarHost
import com.aedst.core.ui.components.AedstTextField
import com.aedst.core.ui.components.AedstTopAppBar
import com.aedst.core.ui.theme.AedstSpacing
import com.aedst.core.ui.theme.AedstTheme
import com.aedst.feature.tasks.R
import com.aedst.feature.tasks.domain.TaskPriority
import com.aedst.feature.tasks.presentation.priorityLabel

@Composable
internal fun TaskCreateRoute(
    onBack: () -> Unit,
    onCreated: (String) -> Unit,
    viewModel: TaskCreateViewModel = hiltViewModel(),
) {
    val state by viewModel.state.collectAsStateWithLifecycle()
    val currentOnCreated by rememberUpdatedState(onCreated)
    LaunchedEffect(viewModel) {
        viewModel.effects.collect { effect ->
            when (effect) {
                is TaskCreateEffect.Created -> currentOnCreated(effect.taskId)
            }
        }
    }
    TaskCreateScreen(state = state, onIntent = viewModel::onIntent, onBack = onBack)
}

@Composable
internal fun TaskCreateScreen(state: TaskCreateState, onIntent: (TaskCreateIntent) -> Unit, onBack: () -> Unit) {
    val snackbarHostState = remember { SnackbarHostState() }
    AedstErrorSnackbarEffect(state.error, snackbarHostState, onShown = { onIntent(TaskCreateIntent.ErrorShown) })

    Scaffold(
        topBar = {
            AedstTopAppBar(
                title = stringResource(R.string.tasks_create),
                navigationIcon = {
                    AedstIconButton(
                        onClick = onBack,
                        contentDescription = stringResource(R.string.tasks_back),
                    ) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = null)
                    }
                },
            )
        },
        snackbarHost = { AedstSnackbarHost(snackbarHostState) },
    ) { padding ->
        AedstAdaptiveContent(modifier = Modifier.padding(padding), maxWidth = AedstContentWidth.form) {
            TaskCreateForm(state, onIntent)
        }
    }
}

@Composable
private fun TaskCreateForm(state: TaskCreateState, onIntent: (TaskCreateIntent) -> Unit) {
    Column(
        modifier = Modifier
            .fillMaxSize()
            .imePadding()
            .verticalScroll(rememberScrollState())
            .padding(AedstSpacing.lg),
        verticalArrangement = Arrangement.spacedBy(AedstSpacing.lg),
    ) {
        AedstTextField(
            value = state.title,
            onValueChange = { onIntent(TaskCreateIntent.TitleChanged(it)) },
            label = stringResource(R.string.tasks_field_title),
            supportingText = stringResource(R.string.tasks_field_title_required).takeIf { state.isTitleInvalid },
            isError = state.isTitleInvalid,
            enabled = !state.isSaving,
            modifier = Modifier.fillMaxWidth(),
        )
        AedstTextField(
            value = state.description,
            onValueChange = { onIntent(TaskCreateIntent.DescriptionChanged(it)) },
            label = stringResource(R.string.tasks_field_description),
            singleLine = false,
            enabled = !state.isSaving,
            modifier = Modifier.fillMaxWidth(),
        )
        Text(stringResource(R.string.tasks_field_priority), style = MaterialTheme.typography.labelLarge)
        Row(horizontalArrangement = Arrangement.spacedBy(AedstSpacing.sm)) {
            TaskPriority.selectable.forEach { priority ->
                AedstFilterChip(
                    selected = state.priority == priority,
                    onClick = { onIntent(TaskCreateIntent.PriorityChanged(priority)) },
                    label = priorityLabel(priority),
                )
            }
        }
        if (state.isQueued) {
            AedstAlert(
                title = stringResource(R.string.tasks_pending_sync_title),
                description = stringResource(R.string.tasks_pending_sync),
                variant = AedstAlertVariant.INFO,
            )
        }
        AedstButton(
            text = stringResource(R.string.tasks_save),
            onClick = { onIntent(TaskCreateIntent.Submit) },
            loading = state.isSaving,
            modifier = Modifier.fillMaxWidth(),
        )
    }
}

@AedstWindowSizePreviews
@Composable
private fun TaskCreateScreenPreview() {
    AedstTheme {
        TaskCreateScreen(state = TaskCreateState(title = "Write the quarterly report"), onIntent = {}, onBack = {})
    }
}
