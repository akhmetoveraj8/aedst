package com.aedst.core.ui.components

import android.content.res.Configuration
import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.Orientation
import androidx.compose.foundation.gestures.draggable
import androidx.compose.foundation.gestures.rememberDraggableState
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.movableContentOf
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.platform.LocalLayoutDirection
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.ProgressBarRangeInfo
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.progressBarRangeInfo
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.setProgress
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.LayoutDirection
import androidx.compose.ui.unit.dp
import com.aedst.core.ui.R
import com.aedst.core.ui.theme.AedstShapesScale
import com.aedst.core.ui.theme.AedstSpacing
import com.aedst.core.ui.theme.AedstTheme

/** Axis along which the two panes of an [AedstResizable] are laid out. */
enum class AedstResizableOrientation {
    HORIZONTAL,
    VERTICAL,
}

/**
 * Two panes with a draggable divider, mirroring web's `resizable.tsx`. [fraction] is the share of the first pane
 * (hoisted, clamped to [range]). The handle has a 48dp touch target and is exposed to accessibility services as an
 * adjustable value ("Resize panels", with a set-progress action), so the split can be changed without dragging.
 * Give the component a bounded size on its main axis.
 */
@Composable
fun AedstResizable(
    fraction: Float,
    onFractionChange: (Float) -> Unit,
    first: @Composable () -> Unit,
    second: @Composable () -> Unit,
    modifier: Modifier = Modifier,
    orientation: AedstResizableOrientation = AedstResizableOrientation.HORIZONTAL,
    range: ClosedFloatingPointRange<Float> = 0.2f..0.8f,
) {
    val clamped = fraction.coerceIn(range)
    // Movable slots: the panes keep their state when the orientation changes.
    val firstPane = remember(first) { movableContentOf(first) }
    val secondPane = remember(second) { movableContentOf(second) }
    var extentPx by remember { mutableIntStateOf(0) }
    val current by rememberUpdatedState(clamped)
    val isRtl = LocalLayoutDirection.current == LayoutDirection.Rtl
    val isHorizontal = orientation == AedstResizableOrientation.HORIZONTAL
    val description = stringResource(R.string.aedst_a11y_resize_handle)
    val dragState = rememberDraggableState { delta ->
        if (extentPx > 0) {
            val signed = if (isHorizontal && isRtl) -delta else delta
            onFractionChange((current + signed / extentPx).coerceIn(range))
        }
    }
    val handle = Modifier
        .draggable(dragState, if (isHorizontal) Orientation.Horizontal else Orientation.Vertical)
        .semantics {
            contentDescription = description
            progressBarRangeInfo = ProgressBarRangeInfo(clamped, range)
            setProgress { target ->
                onFractionChange(target.coerceIn(range))
                true
            }
        }
    val sized = modifier.onSizeChanged { extentPx = if (isHorizontal) it.width else it.height }
    if (isHorizontal) {
        Row(modifier = sized) {
            Box(Modifier.weight(clamped).fillMaxHeight()) { firstPane() }
            Box(handle.width(HANDLE_TOUCH).fillMaxHeight(), contentAlignment = Alignment.Center) {
                Grip(Modifier.width(GRIP_THICKNESS).height(GRIP_LENGTH))
            }
            Box(Modifier.weight(1f - clamped).fillMaxHeight()) { secondPane() }
        }
    } else {
        Column(modifier = sized) {
            Box(Modifier.weight(clamped).fillMaxWidth()) { firstPane() }
            Box(handle.height(HANDLE_TOUCH).fillMaxWidth(), contentAlignment = Alignment.Center) {
                Grip(Modifier.height(GRIP_THICKNESS).width(GRIP_LENGTH))
            }
            Box(Modifier.weight(1f - clamped).fillMaxWidth()) { secondPane() }
        }
    }
}

@Composable
private fun Grip(modifier: Modifier = Modifier) {
    Box(modifier.background(MaterialTheme.colorScheme.outline, AedstShapesScale.pill))
}

private val HANDLE_TOUCH = 48.dp
private val GRIP_THICKNESS = 4.dp
private val GRIP_LENGTH = 32.dp

@Preview(name = "Light", showBackground = true)
@Preview(name = "Dark", uiMode = Configuration.UI_MODE_NIGHT_YES, showBackground = true)
@Composable
private fun AedstResizablePreview() {
    var fraction by remember { mutableFloatStateOf(0.4f) }
    AedstTheme {
        Surface {
            AedstResizable(
                fraction = fraction,
                onFractionChange = { fraction = it },
                first = { Text("List", modifier = Modifier.padding(AedstSpacing.md)) },
                second = { Text("Detail", modifier = Modifier.padding(AedstSpacing.md)) },
                modifier = Modifier.size(width = 360.dp, height = 160.dp),
            )
        }
    }
}
