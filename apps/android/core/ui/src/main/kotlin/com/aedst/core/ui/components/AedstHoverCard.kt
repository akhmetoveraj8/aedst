package com.aedst.core.ui.components

import android.content.res.Configuration
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.RichTooltip
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TooltipAnchorPosition
import androidx.compose.material3.TooltipBox
import androidx.compose.material3.TooltipDefaults
import androidx.compose.material3.rememberTooltipState
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.tooling.preview.Preview
import com.aedst.core.ui.theme.AedstShapesScale
import com.aedst.core.ui.theme.AedstSpacing
import com.aedst.core.ui.theme.AedstTheme

/**
 * Rich preview card for the element in [content], mirroring web's `hover-card.tsx`. A touch screen has no hover, so
 * it is the Material 3 rich tooltip: it opens on touch-and-hold, on mouse hover and on keyboard focus, and stays
 * open until dismissed ([TooltipBox] with a persistent state), so its [card] can be read at any speed. Keep
 * interactive controls out of the card: it is a preview, the destination holds the actions.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun AedstHoverCard(
    card: @Composable () -> Unit,
    modifier: Modifier = Modifier,
    title: String? = null,
    content: @Composable () -> Unit,
) {
    TooltipBox(
        positionProvider = TooltipDefaults.rememberTooltipPositionProvider(TooltipAnchorPosition.Below),
        tooltip = {
            RichTooltip(
                title = title?.let { { Text(it) } },
                shape = AedstShapesScale.large,
                colors = TooltipDefaults.richTooltipColors(
                    containerColor = MaterialTheme.colorScheme.surface,
                    contentColor = MaterialTheme.colorScheme.onSurface,
                    titleContentColor = MaterialTheme.colorScheme.onSurface,
                ),
            ) {
                card()
            }
        },
        state = rememberTooltipState(isPersistent = true),
        modifier = modifier,
        content = content,
    )
}

@Preview(name = "Light", showBackground = true)
@Preview(name = "Dark", uiMode = Configuration.UI_MODE_NIGHT_YES, showBackground = true)
@Composable
private fun AedstHoverCardPreview() {
    AedstTheme {
        Surface {
            AedstHoverCard(
                card = { Text("Joined in 2024. Owner of three projects.") },
                title = "Ada Lovelace",
                modifier = Modifier.padding(AedstSpacing.lg),
            ) {
                Text("@ada")
            }
        }
    }
}
