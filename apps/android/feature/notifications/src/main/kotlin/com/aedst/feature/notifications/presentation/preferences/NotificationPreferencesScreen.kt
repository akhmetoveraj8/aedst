package com.aedst.feature.notifications.presentation.preferences

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material3.Icon
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHostState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.hilt.lifecycle.viewmodel.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.aedst.core.ui.adaptive.AedstAdaptiveContent
import com.aedst.core.ui.adaptive.AedstContentWidth
import com.aedst.core.ui.adaptive.AedstWindowSizePreviews
import com.aedst.core.ui.components.AedstErrorSnackbarEffect
import com.aedst.core.ui.components.AedstIconButton
import com.aedst.core.ui.components.AedstSnackbarHost
import com.aedst.core.ui.components.AedstSwitch
import com.aedst.core.ui.components.AedstTopAppBar
import com.aedst.core.ui.components.FullScreenLoading
import com.aedst.core.ui.theme.AedstSpacing
import com.aedst.core.ui.theme.AedstTheme
import com.aedst.feature.notifications.R
import com.aedst.feature.notifications.domain.NotificationPreferences

@Composable
internal fun NotificationPreferencesRoute(
    onBack: () -> Unit,
    viewModel: NotificationPreferencesViewModel = hiltViewModel(),
) {
    val state by viewModel.state.collectAsStateWithLifecycle()
    NotificationPreferencesScreen(state = state, onIntent = viewModel::onIntent, onBack = onBack)
}

@Composable
internal fun NotificationPreferencesScreen(
    state: NotificationPreferencesState,
    onIntent: (NotificationPreferencesIntent) -> Unit,
    onBack: () -> Unit,
) {
    val snackbarHostState = remember { SnackbarHostState() }
    AedstErrorSnackbarEffect(
        state.error,
        snackbarHostState,
        onShown = { onIntent(NotificationPreferencesIntent.ErrorShown) },
    )

    Scaffold(
        topBar = {
            AedstTopAppBar(
                title = stringResource(R.string.notifications_preferences),
                navigationIcon = {
                    AedstIconButton(
                        onClick = onBack,
                        contentDescription = stringResource(R.string.notifications_back),
                    ) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = null)
                    }
                },
            )
        },
        snackbarHost = { AedstSnackbarHost(snackbarHostState) },
    ) { padding ->
        val prefs = state.preferences
        if (prefs == null) {
            FullScreenLoading(Modifier.padding(padding))
            return@Scaffold
        }
        AedstAdaptiveContent(modifier = Modifier.padding(padding), maxWidth = AedstContentWidth.form) {
            PreferenceSwitches(prefs) { transform -> onIntent(NotificationPreferencesIntent.Update(transform)) }
        }
    }
}

@Composable
private fun PreferenceSwitches(
    prefs: NotificationPreferences,
    onChange: ((NotificationPreferences) -> NotificationPreferences) -> Unit,
) {
    Column(
        modifier = Modifier.fillMaxSize().padding(AedstSpacing.lg),
        verticalArrangement = Arrangement.spacedBy(AedstSpacing.lg),
    ) {
        AedstSwitch(
            checked = prefs.pushEnabled,
            onCheckedChange = { value -> onChange { it.copy(pushEnabled = value) } },
            label = stringResource(R.string.notifications_pref_push),
            modifier = Modifier.fillMaxWidth(),
        )
        AedstSwitch(
            checked = prefs.taskCompleted,
            onCheckedChange = { value -> onChange { it.copy(taskCompleted = value) } },
            label = stringResource(R.string.notifications_pref_task_completed),
            enabled = prefs.pushEnabled,
            modifier = Modifier.fillMaxWidth(),
        )
        AedstSwitch(
            checked = prefs.taskDueSoon,
            onCheckedChange = { value -> onChange { it.copy(taskDueSoon = value) } },
            label = stringResource(R.string.notifications_pref_task_due_soon),
            enabled = prefs.pushEnabled,
            modifier = Modifier.fillMaxWidth(),
        )
        AedstSwitch(
            checked = prefs.mediaReady,
            onCheckedChange = { value -> onChange { it.copy(mediaReady = value) } },
            label = stringResource(R.string.notifications_pref_media_ready),
            enabled = prefs.pushEnabled,
            modifier = Modifier.fillMaxWidth(),
        )
    }
}

@AedstWindowSizePreviews
@Composable
private fun NotificationPreferencesScreenPreview() {
    AedstTheme {
        NotificationPreferencesScreen(
            state = NotificationPreferencesState(),
            onIntent = {},
            onBack = {},
        )
    }
}
