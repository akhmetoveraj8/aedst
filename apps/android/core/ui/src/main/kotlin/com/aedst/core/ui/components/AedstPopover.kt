package com.aedst.core.ui.components

import android.content.res.Configuration
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.IntRect
import androidx.compose.ui.unit.IntSize
import androidx.compose.ui.unit.LayoutDirection
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Popup
import androidx.compose.ui.window.PopupPositionProvider
import androidx.compose.ui.window.PopupProperties
import com.aedst.core.ui.theme.AedstElevation
import com.aedst.core.ui.theme.AedstShapesScale
import com.aedst.core.ui.theme.AedstSpacing
import com.aedst.core.ui.theme.AedstTheme

/**
 * Floating panel anchored under its [trigger], mirroring web's `popover.tsx`. Built on the Compose [Popup]: it is
 * focusable (so it takes accessibility focus and the back button), and it closes on back or an outside tap through
 * [onDismissRequest]. State is hoisted: the trigger's own click sets [expanded]. Use `AedstDropdownMenu` for a list
 * of actions and `AedstDialog` for anything that needs a decision.
 */
@Composable
fun AedstPopover(
    expanded: Boolean,
    onDismissRequest: () -> Unit,
    trigger: @Composable () -> Unit,
    modifier: Modifier = Modifier,
    content: @Composable ColumnScope.() -> Unit,
) {
    Box(modifier = modifier) {
        trigger()
        if (expanded) {
            val gap = with(LocalDensity.current) { AedstSpacing.xs.roundToPx() }
            Popup(
                popupPositionProvider = remember(gap) { BelowAnchorPositionProvider(gap) },
                onDismissRequest = onDismissRequest,
                properties = PopupProperties(focusable = true),
            ) {
                PopoverSurface(content = content)
            }
        }
    }
}

@Composable
private fun PopoverSurface(modifier: Modifier = Modifier, content: @Composable ColumnScope.() -> Unit) {
    Surface(
        modifier = modifier.widthIn(max = MAX_WIDTH),
        shape = AedstShapesScale.large,
        color = MaterialTheme.colorScheme.surface,
        contentColor = MaterialTheme.colorScheme.onSurface,
        border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant),
        shadowElevation = AedstElevation.level3,
    ) {
        Column(modifier = Modifier.padding(AedstSpacing.md), content = content)
    }
}

/** Start-aligned under the anchor; above it when there is no room below; always inside the window. */
private class BelowAnchorPositionProvider(private val gap: Int) : PopupPositionProvider {
    override fun calculatePosition(
        anchorBounds: IntRect,
        windowSize: IntSize,
        layoutDirection: LayoutDirection,
        popupContentSize: IntSize,
    ): IntOffset {
        val startX = if (layoutDirection == LayoutDirection.Ltr) {
            anchorBounds.left
        } else {
            anchorBounds.right - popupContentSize.width
        }
        val below = anchorBounds.bottom + gap
        val y = if (below + popupContentSize.height <= windowSize.height) {
            below
        } else {
            anchorBounds.top - gap - popupContentSize.height
        }
        val maxX = (windowSize.width - popupContentSize.width).coerceAtLeast(0)
        return IntOffset(startX.coerceIn(0, maxX), y.coerceAtLeast(0))
    }
}

private val MAX_WIDTH = 320.dp

/** The panel alone: a real [Popup] is its own window and cannot be statically previewed. */
@Preview(name = "Light", showBackground = true)
@Preview(name = "Dark", uiMode = Configuration.UI_MODE_NIGHT_YES, showBackground = true)
@Composable
private fun AedstPopoverPreview() {
    AedstTheme {
        Surface {
            PopoverSurface(modifier = Modifier.padding(AedstSpacing.lg)) {
                Text("Dimensions", style = MaterialTheme.typography.titleSmall)
                Text("Set the width and height of the layer.")
            }
        }
    }
}
