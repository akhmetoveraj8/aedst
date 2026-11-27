package com.aedst.core.ui.components

import android.content.res.Configuration
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Snackbar
import androidx.compose.material3.SnackbarDuration
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.SnackbarResult
import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.tooling.preview.Preview
import com.aedst.core.ui.theme.AedstShapesScale
import com.aedst.core.ui.theme.AedstTheme

/**
 * Themed host for Material3 snackbars (the "Toast" of web's `sonner`/`toast.tsx`), rendering an
 * inverted-surface [Snackbar] so it reads as a floating overlay in both light and dark mode.
 */
@Composable
fun AedstSnackbarHost(hostState: SnackbarHostState, modifier: Modifier = Modifier) {
    SnackbarHost(hostState = hostState, modifier = modifier) { data ->
        Snackbar(
            snackbarData = data,
            shape = AedstShapesScale.medium,
            containerColor = MaterialTheme.colorScheme.inverseSurface,
            contentColor = MaterialTheme.colorScheme.inverseOnSurface,
            actionColor = MaterialTheme.colorScheme.inversePrimary,
        )
    }
}

/**
 * Shows a snackbar the accessible way (the Material 3 host already makes each one a polite live region with a
 * dismiss action for TalkBack): a dismiss action by default ([withDismissAction]) and a finite [duration]
 * ([SnackbarDuration.Long] when there is an action to reach, otherwise short). The host (Material 3 `SnackbarHost`)
 * passes the duration through `AccessibilityManager.getRecommendedTimeoutMillis`, so the time on screen follows the
 * user's "Time to take action" setting; an [SnackbarDuration.Indefinite] message needs the dismiss action.
 */
suspend fun SnackbarHostState.showAedstSnackbar(
    message: String,
    actionLabel: String? = null,
    withDismissAction: Boolean = true,
    duration: SnackbarDuration = if (actionLabel != null) SnackbarDuration.Long else SnackbarDuration.Short,
): SnackbarResult = showSnackbar(
    message = message,
    actionLabel = actionLabel,
    withDismissAction = withDismissAction,
    duration = duration,
)

@Preview(name = "Light")
@Preview(name = "Dark", uiMode = Configuration.UI_MODE_NIGHT_YES)
@Composable
private fun AedstSnackbarHostPreview() {
    AedstTheme {
        Surface {
            val hostState = remember { SnackbarHostState() }
            LaunchedEffect(Unit) {
                hostState.showAedstSnackbar(message = "Changes saved", actionLabel = "Undo")
            }
            AedstSnackbarHost(hostState = hostState)
        }
    }
}
