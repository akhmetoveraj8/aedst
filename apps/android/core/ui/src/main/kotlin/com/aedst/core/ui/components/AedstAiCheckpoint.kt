package com.aedst.core.ui.components

import android.content.res.Configuration
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.BookmarkBorder
import androidx.compose.material3.Icon
import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.tooling.preview.Preview
import com.aedst.core.ui.theme.AedstSpacing
import com.aedst.core.ui.theme.AedstTheme

/**
 * A point in the conversation the user can return to (web `ai-checkpoint.tsx`): a separator [AedstMarker] after a
 * turn holding an [AedstAiCheckpointIcon], a label ([AedstMarkerContent]) and an [AedstAiCheckpointTrigger].
 * Restoring is the caller's job (keep that turn, drop every later message).
 */
@Composable
fun AedstAiCheckpoint(modifier: Modifier = Modifier, content: @Composable RowScope.() -> Unit) {
    AedstMarker(modifier = modifier.padding(vertical = AedstSpacing.xs), variant = AedstMarkerVariant.SEPARATOR) {
        Row(
            horizontalArrangement = Arrangement.spacedBy(AedstSpacing.sm),
            verticalAlignment = Alignment.CenterVertically,
            content = content,
        )
    }
}

/** Decorative leading icon (a bookmark by default). */
@Composable
fun AedstAiCheckpointIcon(modifier: Modifier = Modifier, icon: ImageVector = Icons.Outlined.BookmarkBorder) {
    AedstMarkerIcon(modifier = modifier) { Icon(imageVector = icon, contentDescription = null) }
}

/**
 * The Restore button (outline, extra small; Material keeps a 48dp target). Give it a [contentDescription] that names
 * the checkpoint ("Restore to Button renamed") when [text] alone is ambiguous; [tooltip] is an optional hint shown on
 * touch-and-hold, hover and focus.
 */
@Composable
fun AedstAiCheckpointTrigger(
    text: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    contentDescription: String? = null,
    tooltip: String? = null,
    enabled: Boolean = true,
) {
    val named = if (contentDescription != null) {
        modifier.semantics { this.contentDescription = contentDescription }
    } else {
        modifier
    }
    val button = @Composable {
        AedstButton(
            text = text,
            onClick = onClick,
            modifier = named,
            variant = AedstButtonVariant.OUTLINE,
            size = AedstButtonSize.XS,
            enabled = enabled,
        )
    }
    if (tooltip == null) button() else AedstTooltip(text = tooltip, content = button)
}

@Preview(name = "Light", showBackground = true)
@Preview(name = "Dark", uiMode = Configuration.UI_MODE_NIGHT_YES, showBackground = true)
@Composable
private fun AedstAiCheckpointPreview() {
    AedstTheme {
        Surface {
            AedstAiCheckpoint {
                AedstAiCheckpointIcon()
                AedstMarkerContent("Button renamed")
                AedstAiCheckpointTrigger(text = "Restore", onClick = {}, tooltip = "Restore the thread to this point")
            }
        }
    }
}
