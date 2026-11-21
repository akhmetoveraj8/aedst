package com.aedst.core.ui.components

import android.content.res.Configuration
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Info
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.PlainTooltip
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TooltipAnchorPosition
import androidx.compose.material3.TooltipBox
import androidx.compose.material3.TooltipDefaults
import androidx.compose.material3.rememberTooltipState
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.tooling.preview.Preview
import com.aedst.core.ui.theme.AedstSpacing
import com.aedst.core.ui.theme.AedstTheme

/**
 * Short text hint for the control in [content], mirroring web's `tooltip.tsx`. Built on Material 3 [TooltipBox] with
 * a [PlainTooltip]: it opens on touch-and-hold, on mouse hover and on keyboard focus, and the anchor gets a
 * "show tooltip" accessibility action. Never put information only in a tooltip: icon-only controls still need a
 * content description.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun AedstTooltip(text: String, modifier: Modifier = Modifier, content: @Composable () -> Unit) {
    TooltipBox(
        positionProvider = TooltipDefaults.rememberTooltipPositionProvider(TooltipAnchorPosition.Above),
        tooltip = { PlainTooltip { Text(text) } },
        state = rememberTooltipState(),
        modifier = modifier,
        content = content,
    )
}

@Preview(name = "Light", showBackground = true)
@Preview(name = "Dark", uiMode = Configuration.UI_MODE_NIGHT_YES, showBackground = true)
@Composable
private fun AedstTooltipPreview() {
    AedstTheme {
        Surface {
            AedstTooltip(text = "More information", modifier = Modifier.padding(AedstSpacing.lg)) {
                AedstIconButton(onClick = {}, contentDescription = "More information") {
                    Icon(Icons.Default.Info, contentDescription = null)
                }
            }
        }
    }
}
