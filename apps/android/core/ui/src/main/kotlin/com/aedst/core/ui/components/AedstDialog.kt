package com.aedst.core.ui.components

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import com.aedst.core.ui.theme.AedstElevation
import com.aedst.core.ui.theme.AedstShapesScale
import com.aedst.core.ui.theme.AedstSpacing
import com.aedst.core.ui.theme.AedstTheme

/**
 * Generic modal dialog primitive, mirroring web's `dialog.tsx` root. Wraps [Dialog] with a themed
 * [Surface] so callers only supply the inner content. For an opinionated confirm/cancel variant,
 * use `AedstAlertDialog` instead.
 */
@Composable
fun AedstDialog(
    onDismissRequest: () -> Unit,
    modifier: Modifier = Modifier,
    properties: DialogProperties = DialogProperties(),
    content: @Composable ColumnScope.() -> Unit,
) {
    Dialog(onDismissRequest = onDismissRequest, properties = properties) {
        Surface(
            modifier = modifier,
            shape = AedstShapesScale.large,
            color = MaterialTheme.colorScheme.surface,
            contentColor = MaterialTheme.colorScheme.onSurface,
            tonalElevation = AedstElevation.level3,
        ) {
            Column(
                modifier = Modifier.padding(AedstSpacing.xl),
                content = content,
            )
        }
    }
}

/** Static content used only by [AedstDialogPreview]; a real [Dialog] cannot be statically previewed. */
@Composable
private fun AedstDialogPreviewContent() {
    Surface(
        shape = AedstShapesScale.large,
        color = MaterialTheme.colorScheme.surface,
        contentColor = MaterialTheme.colorScheme.onSurface,
        tonalElevation = AedstElevation.level3,
    ) {
        Column(modifier = Modifier.padding(AedstSpacing.xl)) {
            Text("Delete task?", style = MaterialTheme.typography.titleMedium)
            Text(
                "This action cannot be undone.",
                style = MaterialTheme.typography.bodyMedium,
            )
        }
    }
}

@Preview(name = "Light", showBackground = true)
@Preview(name = "Dark", showBackground = true, uiMode = android.content.res.Configuration.UI_MODE_NIGHT_YES)
@Composable
private fun AedstDialogPreview() {
    AedstTheme {
        Surface(color = MaterialTheme.colorScheme.background) {
            Column(modifier = Modifier.padding(AedstSpacing.lg)) {
                AedstDialogPreviewContent()
            }
        }
    }
}
