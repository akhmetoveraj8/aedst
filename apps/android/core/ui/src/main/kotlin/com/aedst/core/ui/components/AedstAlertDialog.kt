package com.aedst.core.ui.components

import android.content.res.Configuration
import androidx.compose.foundation.layout.Column
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.tooling.preview.Preview
import com.aedst.core.ui.R
import com.aedst.core.ui.theme.AedstTheme

/**
 * Confirmation dialog wrapping Material3's [AlertDialog], mirroring web's `alert-dialog.tsx`.
 * When [isDestructive] is set the confirm action is tinted with [MaterialTheme.colorScheme]'s
 * error color, matching the destructive `AlertDialogAction` treatment on web.
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
    content: (@Composable () -> Unit)? = null,
) {
    AlertDialog(
        onDismissRequest = onDismiss,
        modifier = modifier,
        title = { Text(title) },
        text = if (text == null && content == null) {
            null
        } else {
            {
                Column {
                    text?.let { Text(it) }
                    content?.invoke()
                }
            }
        },
        confirmButton = {
            TextButton(
                onClick = onConfirm,
                enabled = confirmEnabled,
                colors = if (isDestructive) {
                    ButtonDefaults.textButtonColors(contentColor = MaterialTheme.colorScheme.error)
                } else {
                    ButtonDefaults.textButtonColors()
                },
            ) {
                Text(confirmLabel)
            }
        },
        dismissButton = {
            TextButton(onClick = onDismiss) {
                Text(dismissLabel)
            }
        },
    )
}

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
            )
        }
    }
}
