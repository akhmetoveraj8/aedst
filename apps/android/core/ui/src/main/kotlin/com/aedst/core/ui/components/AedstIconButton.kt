package com.aedst.core.ui.components

import android.content.res.Configuration
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material3.FilledIconButton
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.IconButtonDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedIconButton
import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.disabled
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import com.aedst.core.ui.theme.AedstTheme

/** Visual treatment of [AedstIconButton], mirroring web's icon-only `Button` variants. */
enum class AedstIconButtonVariant {
    DEFAULT,
    FILLED,
    OUTLINE,
    GHOST,
}

/**
 * Icon-only action control. Callers pass an `Icon(..., contentDescription = null)` (or any other
 * composable) into [icon]; [contentDescription] is applied at the button level so the accessible
 * name always matches the action regardless of what the slot renders.
 */
@Composable
fun AedstIconButton(
    onClick: () -> Unit,
    contentDescription: String,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
    variant: AedstIconButtonVariant = AedstIconButtonVariant.DEFAULT,
    icon: @Composable () -> Unit,
) {
    val buttonModifier = modifier.semantics {
        this.contentDescription = contentDescription
        if (!enabled) disabled()
    }

    when (variant) {
        AedstIconButtonVariant.DEFAULT -> IconButton(
            onClick = onClick,
            modifier = buttonModifier,
            enabled = enabled,
            content = icon,
        )

        AedstIconButtonVariant.FILLED -> FilledIconButton(
            onClick = onClick,
            modifier = buttonModifier,
            enabled = enabled,
            colors = IconButtonDefaults.filledIconButtonColors(
                containerColor = MaterialTheme.colorScheme.secondary,
                contentColor = MaterialTheme.colorScheme.onSecondary,
            ),
            content = icon,
        )

        AedstIconButtonVariant.OUTLINE -> OutlinedIconButton(
            onClick = onClick,
            modifier = buttonModifier,
            enabled = enabled,
            border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant),
            content = icon,
        )

        AedstIconButtonVariant.GHOST -> IconButton(
            onClick = onClick,
            modifier = buttonModifier,
            enabled = enabled,
            colors = IconButtonDefaults.iconButtonColors(
                contentColor = MaterialTheme.colorScheme.onSurfaceVariant,
            ),
            content = icon,
        )
    }
}

@Preview(name = "Light", showBackground = true)
@Preview(name = "Dark", uiMode = Configuration.UI_MODE_NIGHT_YES, showBackground = true)
@Composable
private fun AedstIconButtonPreview() {
    AedstTheme {
        Surface {
            Row(
                horizontalArrangement = Arrangement.spacedBy(12.dp),
                modifier = Modifier.padding(12.dp),
            ) {
                AedstIconButtonVariant.entries.forEach { variant ->
                    AedstIconButton(
                        onClick = {},
                        contentDescription = "Add item",
                        variant = variant,
                    ) {
                        Icon(imageVector = Icons.Default.Add, contentDescription = null)
                    }
                }
            }
        }
    }
}
