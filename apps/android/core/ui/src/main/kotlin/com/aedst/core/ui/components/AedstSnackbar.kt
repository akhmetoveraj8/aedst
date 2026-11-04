package com.aedst.core.ui.components

import android.content.res.Configuration
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Snackbar
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
 * Thin convenience wrapper around [SnackbarHostState.showSnackbar]. It exists only so call sites
 * reach for `showAedstSnackbar` alongside the rest of the `Aedst*` component surface instead of
 * discovering the underlying Material3 API on their own; behavior is identical to `showSnackbar`.
 */
suspend fun SnackbarHostState.showAedstSnackbar(
    message: String,
    actionLabel: String? = null,
    withDismissAction: Boolean = false,
): SnackbarResult = showSnackbar(
    message = message,
    actionLabel = actionLabel,
    withDismissAction = withDismissAction,
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
