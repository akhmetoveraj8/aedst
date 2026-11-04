package com.aedst.feature.auth.presentation.login

import android.content.ActivityNotFoundException
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import androidx.hilt.lifecycle.viewmodel.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.aedst.core.ui.adaptive.AedstAdaptiveContent
import com.aedst.core.ui.adaptive.AedstContentWidth
import com.aedst.core.ui.adaptive.AedstWindowSizePreviews
import com.aedst.core.ui.components.AedstAlert
import com.aedst.core.ui.components.AedstAlertVariant
import com.aedst.core.ui.components.AedstButton
import com.aedst.core.ui.components.AedstButtonSize
import com.aedst.core.ui.components.userMessage
import com.aedst.core.ui.theme.AedstSpacing
import com.aedst.core.ui.theme.AedstTheme
import com.aedst.feature.auth.R

@Composable
internal fun LoginRoute(onLoggedIn: () -> Unit, viewModel: LoginViewModel = hiltViewModel()) {
    val state by viewModel.state.collectAsStateWithLifecycle()
    val currentOnLoggedIn by rememberUpdatedState(onLoggedIn)
    // Registered with a stable key, so a result delivered after the activity was recreated (or the process died while
    // the browser was open) reaches the new view model instance.
    val launcher = rememberLauncherForActivityResult(AuthorizationActivityContract()) { callback ->
        viewModel.onIntent(LoginIntent.AuthorizationReturned(callback))
    }

    LaunchedEffect(viewModel) {
        viewModel.effects.collect { effect ->
            when (effect) {
                LoginEffect.NavigateToHome -> currentOnLoggedIn()
                is LoginEffect.LaunchBrowser -> try {
                    launcher.launch(effect.launch)
                } catch (@Suppress("SwallowedException") noBrowser: ActivityNotFoundException) {
                    viewModel.onIntent(LoginIntent.BrowserUnavailable)
                }
            }
        }
    }

    LoginScreen(state = state, onIntent = viewModel::onIntent)
}

@Composable
internal fun LoginScreen(state: LoginState, onIntent: (LoginIntent) -> Unit) {
    // Capped at a form width, centred, and kept clear of a fold, so tablets/foldables/landscape don't stretch the form.
    AedstAdaptiveContent(modifier = Modifier.safeDrawingPadding(), maxWidth = AedstContentWidth.form) {
        Column(
            modifier = Modifier
                .fillMaxSize()
                .verticalScroll(rememberScrollState())
                .padding(AedstSpacing.xxl),
            verticalArrangement = Arrangement.spacedBy(AedstSpacing.lg),
        ) {
            Text(
                text = stringResource(R.string.auth_login_title),
                style = MaterialTheme.typography.headlineMedium,
                modifier = Modifier.semantics { heading() },
            )
            Text(
                text = stringResource(R.string.auth_login_subtitle),
                style = MaterialTheme.typography.bodyLarge,
            )
            // AedstAlert is a polite live region, so TalkBack announces a problem that appears after composition.
            state.problem?.let { problem -> ProblemAlert(problem) }
            AedstButton(
                text = stringResource(R.string.auth_login_submit),
                onClick = { onIntent(LoginIntent.SignIn) },
                enabled = state.problem != LoginProblem.NotConfigured,
                loading = state.isLoading,
                size = AedstButtonSize.LG,
                modifier = Modifier
                    .fillMaxWidth()
                    .heightIn(min = MIN_TOUCH_TARGET),
            )
        }
    }
}

@Composable
private fun ProblemAlert(problem: LoginProblem) {
    val title = when (problem) {
        LoginProblem.NotConfigured -> stringResource(R.string.auth_login_not_configured)
        LoginProblem.NoBrowser -> stringResource(R.string.auth_login_no_browser)
        is LoginProblem.Failed -> stringResource(R.string.auth_login_failed_title)
    }
    val description = (problem as? LoginProblem.Failed)?.error?.userMessage()
    AedstAlert(
        title = title,
        description = description,
        variant = when (problem) {
            LoginProblem.NotConfigured -> AedstAlertVariant.WARNING
            else -> AedstAlertVariant.DESTRUCTIVE
        },
    )
}

private val MIN_TOUCH_TARGET = 48.dp // allow-dp: accessibility minimum touch target, not a spacing step

@AedstWindowSizePreviews
@Composable
private fun LoginScreenWindowSizesPreview() {
    AedstTheme { LoginScreen(state = LoginState(), onIntent = {}) }
}
