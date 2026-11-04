package com.aedst.android

import android.content.res.Configuration
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBars
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.tooling.preview.Preview
import com.aedst.core.ui.components.AedstAlert
import com.aedst.core.ui.components.AedstAlertVariant
import com.aedst.core.ui.components.AedstButton
import com.aedst.core.ui.components.AedstButtonSize
import com.aedst.core.ui.components.AedstButtonVariant
import com.aedst.core.ui.theme.AedstSpacing
import com.aedst.core.ui.theme.AedstTheme
import com.aedst.core.ui.R as UiR

/**
 * Shown under the offline banner while queued writes are parked as failed (a permanent error, or attempts used up):
 * the user decides whether to send them again or drop them. Nothing is shown when [failedCount] is zero.
 */
@Composable
fun OutboxFailedAlert(failedCount: Int, onRetry: () -> Unit, onDiscard: () -> Unit, modifier: Modifier = Modifier) {
    if (failedCount <= 0) return
    AedstAlert(
        title = stringResource(R.string.outbox_failed_title),
        description = stringResource(R.string.outbox_failed_description),
        variant = AedstAlertVariant.WARNING,
        modifier = modifier.windowInsetsPadding(WindowInsets.statusBars).padding(AedstSpacing.sm),
        actions = {
            AedstButton(
                text = stringResource(UiR.string.aedst_action_retry),
                onClick = onRetry,
                size = AedstButtonSize.SM,
            )
            AedstButton(
                text = stringResource(R.string.outbox_failed_discard),
                onClick = onDiscard,
                variant = AedstButtonVariant.OUTLINE,
                size = AedstButtonSize.SM,
            )
        },
    )
}

@Preview(name = "Light", showBackground = true)
@Preview(name = "Dark", uiMode = Configuration.UI_MODE_NIGHT_YES, showBackground = true)
@Composable
private fun OutboxFailedAlertPreview() {
    AedstTheme {
        OutboxFailedAlert(failedCount = 2, onRetry = {}, onDiscard = {})
    }
}
