package com.aedst.feature.auth.presentation.devicelogin

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.hilt.lifecycle.viewmodel.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.aedst.core.ui.adaptive.AedstWindowSizePreviews
import com.aedst.core.ui.components.AedstAlert
import com.aedst.core.ui.components.AedstAlertVariant
import com.aedst.core.ui.components.AedstButton
import com.aedst.core.ui.components.AedstButtonSize
import com.aedst.core.ui.components.AedstCircularProgressIndicator
import com.aedst.core.ui.components.userMessage
import com.aedst.core.ui.theme.AedstSpacing
import com.aedst.core.ui.theme.AedstTheme
import com.aedst.feature.auth.R
import com.aedst.feature.auth.navigation.AuthActionButton

/** TV sign-in (OAuth device flow). Used by `app-tv` through `AuthNavGraph(useDeviceFlow = true)`. */
@Composable
internal fun DeviceLoginRoute(
    onLoggedIn: () -> Unit,
    actionButton: AuthActionButton?,
    viewModel: DeviceLoginViewModel = hiltViewModel(),
) {
    val state by viewModel.state.collectAsStateWithLifecycle()
    val currentOnLoggedIn by rememberUpdatedState(onLoggedIn)

    LaunchedEffect(viewModel) {
        viewModel.effects.collect { effect ->
            when (effect) {
                DeviceLoginEffect.NavigateToHome -> currentOnLoggedIn()
            }
        }
    }

    DeviceLoginScreen(state = state, onIntent = viewModel::onIntent, actionButton = actionButton)
}

@Composable
internal fun DeviceLoginScreen(
    state: DeviceLoginState,
    onIntent: (DeviceLoginIntent) -> Unit,
    actionButton: AuthActionButton? = null,
) {
    val buttonFocus = remember { FocusRequester() }
    // D-pad users must land on the action: focus it whenever the screen has something to act on (a failure), and
    // keep it reachable while waiting so "Get a new code" is one OK press away.
    LaunchedEffect(state is DeviceLoginState.Failed) { runCatching { buttonFocus.requestFocus() } }

    Box(modifier = Modifier.fillMaxSize().safeDrawingPadding(), contentAlignment = Alignment.Center) {
        Column(
            modifier = Modifier.widthIn(max = CONTENT_MAX_WIDTH).fillMaxWidth().padding(AedstSpacing.massive),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(AedstSpacing.xl),
        ) {
            Text(
                text = stringResource(R.string.auth_device_title),
                style = MaterialTheme.typography.displaySmall,
                textAlign = TextAlign.Center,
                modifier = Modifier.semantics { heading() },
            )
            when (state) {
                DeviceLoginState.Requesting, DeviceLoginState.Success -> AedstCircularProgressIndicator(progress = null)
                is DeviceLoginState.WaitingForUser -> Waiting(state)
                is DeviceLoginState.Failed -> ProblemAlert(state.problem)
            }
            val newCodeText = stringResource(R.string.auth_device_new_code)
            val newCodeEnabled = state != DeviceLoginState.Success &&
                (state as? DeviceLoginState.Failed)?.problem != DeviceLoginProblem.NotConfigured
            val newCode = { onIntent(DeviceLoginIntent.GetNewCode) }
            if (actionButton != null) {
                actionButton(newCodeText, newCode, Modifier.focusRequester(buttonFocus), newCodeEnabled, false)
            } else {
                AedstButton(
                    text = newCodeText,
                    onClick = newCode,
                    enabled = newCodeEnabled,
                    size = AedstButtonSize.LG,
                    modifier = Modifier.focusRequester(buttonFocus),
                )
            }
        }
    }
}

@Composable
private fun Waiting(state: DeviceLoginState.WaitingForUser) {
    Column(
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(AedstSpacing.xl),
    ) {
        Text(
            text = stringResource(R.string.auth_device_step_open),
            style = MaterialTheme.typography.headlineSmall,
            textAlign = TextAlign.Center,
        )
        Text(
            text = state.verificationUri,
            style = MaterialTheme.typography.headlineMedium,
            fontWeight = FontWeight.Bold,
            textAlign = TextAlign.Center,
        )
        Text(
            text = stringResource(R.string.auth_device_step_enter),
            style = MaterialTheme.typography.headlineSmall,
            textAlign = TextAlign.Center,
        )
        // The code is read out character by character ("K, W, P, 4"); the visible glyphs are hidden from the reader so
        // it is not announced twice or as a word.
        val spokenCode = state.userCode.toList().joinToString(separator = ", ")
        val codeDescription = stringResource(R.string.auth_device_code_description, spokenCode)
        Text(
            text = state.userCode,
            fontSize = CODE_FONT_SIZE,
            fontFamily = FontFamily.Monospace,
            fontWeight = FontWeight.Bold,
            letterSpacing = 6.sp,
            color = MaterialTheme.colorScheme.primary,
            textAlign = TextAlign.Center,
            modifier = Modifier.semantics { contentDescription = codeDescription },
        )
        // The pre-filled link is the text alternative to a QR code (no QR library is used; see feature/auth README note).
        state.verificationUriComplete?.let { complete ->
            Text(
                text = stringResource(R.string.auth_device_or_open, complete),
                style = MaterialTheme.typography.titleMedium,
                textAlign = TextAlign.Center,
            )
        }
        val minutes = state.remainingSeconds / SECONDS_PER_MINUTE
        val seconds = state.remainingSeconds % SECONDS_PER_MINUTE
        Text(
            text = stringResource(R.string.auth_device_expires_in, minutes, seconds),
            style = MaterialTheme.typography.titleMedium,
            textAlign = TextAlign.Center,
        )
        Text(
            text = stringResource(R.string.auth_device_waiting),
            style = MaterialTheme.typography.bodyLarge,
            textAlign = TextAlign.Center,
        )
    }
}

@Composable
private fun ProblemAlert(problem: DeviceLoginProblem) {
    val title = when (problem) {
        DeviceLoginProblem.NotConfigured -> stringResource(R.string.auth_login_not_configured)
        DeviceLoginProblem.Denied -> stringResource(R.string.auth_device_denied)
        DeviceLoginProblem.Expired -> stringResource(R.string.auth_device_expired)
        is DeviceLoginProblem.Failed -> stringResource(R.string.auth_login_failed_title)
    }
    AedstAlert(
        title = title,
        description = (problem as? DeviceLoginProblem.Failed)?.error?.userMessage(),
        variant = when (problem) {
            DeviceLoginProblem.NotConfigured -> AedstAlertVariant.WARNING
            else -> AedstAlertVariant.DESTRUCTIVE
        },
    )
}

private val CONTENT_MAX_WIDTH = 900.dp // allow-dp: TV content column cap, not a spacing step
private val CODE_FONT_SIZE = 64.sp
private const val SECONDS_PER_MINUTE = 60L

@AedstWindowSizePreviews
@Composable
private fun DeviceLoginScreenPreview() {
    AedstTheme {
        DeviceLoginScreen(
            state = DeviceLoginState.WaitingForUser(
                userCode = "KWP4-9XZ2",
                verificationUri = "https://id.example.com/device",
                verificationUriComplete = null,
                remainingSeconds = 540,
            ),
            onIntent = {},
        )
    }
}
