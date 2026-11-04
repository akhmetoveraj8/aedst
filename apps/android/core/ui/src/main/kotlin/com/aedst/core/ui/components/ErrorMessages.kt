package com.aedst.core.ui.components

import androidx.annotation.StringRes
import androidx.compose.material3.SnackbarDuration
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.SnackbarResult
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.ui.res.stringResource
import com.aedst.core.common.AedstError
import com.aedst.core.common.isRetryable
import com.aedst.core.ui.R

/**
 * The single place an [AedstError] becomes user-facing text. Diagnostic `error.message` strings (English, possibly
 * carrying server detail) are for logs only; users always see the localized string for the error's *kind*.
 * The Connect-code → kind mapping lives in `core/network`'s `toAedstError()`.
 */
@StringRes
fun AedstError.userMessageRes(): Int = when (this) {
    is AedstError.Offline -> R.string.aedst_error_offline
    is AedstError.Unavailable, is AedstError.Timeout -> R.string.aedst_error_network
    is AedstError.Unauthenticated -> R.string.aedst_error_unauthorized
    is AedstError.Forbidden -> R.string.aedst_error_forbidden
    is AedstError.NotFound -> R.string.aedst_error_not_found
    is AedstError.InvalidInput -> R.string.aedst_error_validation
    is AedstError.Conflict -> R.string.aedst_error_conflict
    is AedstError.RateLimited -> R.string.aedst_error_rate_limited
    is AedstError.UpgradeRequired -> R.string.aedst_error_upgrade_required
    is AedstError.Storage -> R.string.aedst_error_storage
    is AedstError.Cancelled, is AedstError.Unknown -> R.string.aedst_error_unknown
}

@Composable
fun AedstError.userMessage(): String = stringResource(userMessageRes())

/**
 * Shows a transient (non-form) error as a snackbar exactly once, then calls [onShown] so the ViewModel can clear it
 * from state. Errors that belong next to a field (login form) are rendered inline instead.
 *
 * Pass [onRetry] where repeating the action is safe and cheap (a reload): a *retryable* error (offline, unavailable,
 * timeout, rate limited) then carries a "Retry" action and stays on screen longer; other kinds never offer it.
 *
 * ```
 * AedstErrorSnackbarEffect(state.error, snackbarHostState, onShown = { onIntent(Intent.ErrorShown) },
 *     onRetry = { onIntent(Intent.Refresh) })
 * ```
 */
@Composable
fun AedstErrorSnackbarEffect(
    error: AedstError?,
    hostState: SnackbarHostState,
    onShown: () -> Unit,
    onRetry: (() -> Unit)? = null,
) {
    val message = error?.userMessage()
    val retryLabel = stringResource(R.string.aedst_action_retry)
    val canRetry = onRetry != null && error?.isRetryable == true
    val currentOnShown by rememberUpdatedState(onShown)
    val currentOnRetry by rememberUpdatedState(onRetry)
    LaunchedEffect(error) {
        // A cancelled call is user intent, not a failure: clear it without showing anything.
        if (error is AedstError.Cancelled) {
            currentOnShown()
        } else if (error != null && message != null) {
            val result = hostState.showSnackbar(
                message = message,
                actionLabel = retryLabel.takeIf { canRetry },
                duration = if (canRetry) SnackbarDuration.Long else SnackbarDuration.Short,
            )
            currentOnShown()
            if (result == SnackbarResult.ActionPerformed) currentOnRetry?.invoke()
        }
    }
}
