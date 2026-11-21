package com.aedst.core.ui.components

import android.content.res.Configuration
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Close
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import com.aedst.core.ui.R
import com.aedst.core.ui.theme.AedstElevation
import com.aedst.core.ui.theme.AedstSpacing
import com.aedst.core.ui.theme.AedstTheme

/** Window edge an [AedstSheet] is attached to. `START` / `END` follow the layout direction (web: left / right). */
enum class AedstSheetSide {
    TOP,
    END,
    BOTTOM,
    START,
}

/**
 * Modal panel attached to a window edge, mirroring web's `sheet.tsx`. Material 3 has no modal side sheet for
 * Compose, so this is a full-window [Dialog] (it gets the scrim, focus trapping and the back button from the
 * platform) with the panel aligned to [side]; tapping the scrim or the close button calls [onDismissRequest]. For
 * the bottom edge with drag-to-dismiss use `AedstBottomSheet`.
 */
// The root layout is the full-window scrim; the caller's modifier belongs to the panel inside it.
@Suppress("ModifierNotUsedAtRoot")
@Composable
fun AedstSheet(
    title: String,
    onDismissRequest: () -> Unit,
    modifier: Modifier = Modifier,
    side: AedstSheetSide = AedstSheetSide.END,
    content: @Composable ColumnScope.() -> Unit,
) {
    Dialog(onDismissRequest = onDismissRequest, properties = DialogProperties(usePlatformDefaultWidth = false)) {
        Box(
            modifier = Modifier
                .fillMaxSize()
                .pointerInput(onDismissRequest) { detectTapGestures { onDismissRequest() } },
        ) {
            val alignment = when (side) {
                AedstSheetSide.TOP -> Alignment.TopCenter
                AedstSheetSide.END -> Alignment.CenterEnd
                AedstSheetSide.BOTTOM -> Alignment.BottomCenter
                AedstSheetSide.START -> Alignment.CenterStart
            }
            SheetPanel(
                title = title,
                onDismissRequest = onDismissRequest,
                side = side,
                // Taps on the panel must not reach the scrim's dismiss handler.
                modifier = modifier.align(alignment).pointerInput(Unit) { detectTapGestures { } },
                content = content,
            )
        }
    }
}

@Composable
private fun SheetPanel(
    title: String,
    onDismissRequest: () -> Unit,
    side: AedstSheetSide,
    modifier: Modifier = Modifier,
    content: @Composable ColumnScope.() -> Unit,
) {
    val size = when (side) {
        AedstSheetSide.START, AedstSheetSide.END -> Modifier.fillMaxHeight().widthIn(max = SIDE_WIDTH).fillMaxWidth()
        AedstSheetSide.TOP, AedstSheetSide.BOTTOM -> Modifier.fillMaxWidth()
    }
    Surface(
        modifier = modifier.then(size),
        color = MaterialTheme.colorScheme.surface,
        contentColor = MaterialTheme.colorScheme.onSurface,
        shadowElevation = AedstElevation.level3,
    ) {
        Column(modifier = Modifier.padding(AedstSpacing.xl)) {
            Row(modifier = Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                Text(
                    text = title,
                    style = MaterialTheme.typography.titleMedium,
                    modifier = Modifier.weight(1f).semantics { heading() },
                )
                AedstIconButton(
                    onClick = onDismissRequest,
                    contentDescription = stringResource(R.string.aedst_a11y_close),
                ) {
                    Icon(Icons.Default.Close, contentDescription = null)
                }
            }
            content()
        }
    }
}

private val SIDE_WIDTH = 360.dp

/** The panel alone: a real [Dialog] is its own window and cannot be statically previewed. */
@Preview(name = "Light", showBackground = true)
@Preview(name = "Dark", uiMode = Configuration.UI_MODE_NIGHT_YES, showBackground = true)
@Composable
private fun AedstSheetPreview() {
    AedstTheme {
        Surface {
            SheetPanel(title = "Filters", onDismissRequest = {}, side = AedstSheetSide.BOTTOM) {
                Text("Choose which tasks to show.")
            }
        }
    }
}
