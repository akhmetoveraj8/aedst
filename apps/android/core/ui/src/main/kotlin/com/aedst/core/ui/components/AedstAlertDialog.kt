package com.aedst.core.ui.components

import android.content.res.Configuration
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.widthIn
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import com.aedst.core.ui.R
import com.aedst.core.ui.theme.AedstSpacing
import com.aedst.core.ui.theme.AedstTheme

/** Width and footer layout of an [AedstAlertDialog], mirroring web's `alert-dialog.tsx` `size`. */
enum class AedstAlertDialogSize {
    /** Up to 384dp wide, start-aligned text, actions at the end of the footer. */
    DEFAULT,

    /** Up to 320dp wide, centred text, the two actions side by side at equal width. */
    SM,
}

/**
 * Confirmation dialog wrapping Material3's [AlertDialog], mirroring web's `alert-dialog.tsx`.
 * When [isDestructive] is set the confirm action is tinted with [MaterialTheme.colorScheme]'s
 * error color, matching the destructive `AlertDialogAction` treatment on web. [size] follows web's
 * `size` prop (`default` / `sm`).
 */
@Composable
fun AedstAlertDialog(
    title: String,
    onConfirm: () -> Unit,
    onDismiss: () -> Unit,
    modifier: Modifier = Modifier,
    text: String? = null,
    confirmLabel: String = stringResource(R.string.aedst_action_confirm),
    dismissLabel: String = stringResource(R.string.aedst_action_cancel),
    isDestructive: Boolean = false,
    confirmEnabled: Boolean = true,
    size: AedstAlertDialogSize = AedstAlertDialogSize.DEFAULT,
    content: (@Composable () -> Unit)? = null,
) {
    val compact = size == AedstAlertDialogSize.SM
    val textAlign = if (compact) TextAlign.Center else TextAlign.Start
    val confirm: @Composable (Modifier) -> Unit = { buttonModifier ->
        TextButton(
            onClick = onConfirm,
            modifier = buttonModifier,
            enabled = confirmEnabled,
            colors = if (isDestructive) {
                ButtonDefaults.textButtonColors(contentColor = MaterialTheme.colorScheme.error)
            } else {
                ButtonDefaults.textButtonColors()
            },
        ) {
            Text(confirmLabel)
        }
    }
    val dismiss: @Composable (Modifier) -> Unit = { buttonModifier ->
        TextButton(onClick = onDismiss, modifier = buttonModifier) { Text(dismissLabel) }
    }
    AlertDialog(
        onDismissRequest = onDismiss,
        modifier = modifier.widthIn(max = if (compact) SM_MAX_WIDTH else DEFAULT_MAX_WIDTH),
        title = { Text(title, modifier = Modifier.fillMaxWidth(), textAlign = textAlign) },
        text = if (text == null && content == null) {
            null
        } else {
            {
                Column {
                    text?.let { Text(it, modifier = Modifier.fillMaxWidth(), textAlign = textAlign) }
                    content?.invoke()
                }
            }
        },
        confirmButton = {
            if (compact) {
                Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(AedstSpacing.sm)) {
                    dismiss(Modifier.weight(1f))
                    confirm(Modifier.weight(1f))
                }
            } else {
                confirm(Modifier)
            }
        },
        dismissButton = if (compact) null else ({ dismiss(Modifier) }),
    )
}

private val DEFAULT_MAX_WIDTH = 384.dp // allow-dp: web max-w-sm
private val SM_MAX_WIDTH = 320.dp // allow-dp: web max-w-xs

@Preview(name = "Light")
@Preview(name = "Dark", uiMode = Configuration.UI_MODE_NIGHT_YES)
@Composable
private fun AedstAlertDialogPreview() {
    AedstTheme {
        Surface {
            AedstAlertDialog(
                title = "Delete task?",
                text = "This action cannot be undone. The task will be permanently removed.",
                onConfirm = {},
                onDismiss = {},
                confirmLabel = "Delete",
                isDestructive = true,
                size = AedstAlertDialogSize.SM,
            )
        }
    }
}
