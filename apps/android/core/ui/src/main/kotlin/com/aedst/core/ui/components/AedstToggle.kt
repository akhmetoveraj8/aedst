package com.aedst.core.ui.components

import android.content.res.Configuration
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Star
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.Dp
import com.aedst.core.ui.theme.AedstHairline
import com.aedst.core.ui.theme.AedstShapesScale
import com.aedst.core.ui.theme.AedstSpacing
import com.aedst.core.ui.theme.AedstTheme

/** Visual treatment of [AedstToggle], mirroring web's `toggle.tsx` `variant` prop. */
enum class AedstToggleVariant {
    DEFAULT,
    OUTLINE,
}

/** Sizing of [AedstToggle], mirroring web's `toggle.tsx` `size` prop. The touch target stays 48dp for every size. */
enum class AedstToggleSize(internal val minSize: Dp) {
    DEFAULT(AedstSpacing.huge),
    SM(AedstSpacing.xxxl),
    LG(AedstSpacing.massive),
}

/**
 * Two-state button (bold, favourite, a view switch), mirroring web's `toggle.tsx`. Exposed to accessibility services
 * as a checkable control; an icon-only toggle must give its icon a content description.
 */
@Composable
fun AedstToggle(
    pressed: Boolean,
    onPressedChange: (Boolean) -> Unit,
    modifier: Modifier = Modifier,
    variant: AedstToggleVariant = AedstToggleVariant.DEFAULT,
    size: AedstToggleSize = AedstToggleSize.DEFAULT,
    enabled: Boolean = true,
    content: @Composable RowScope.() -> Unit,
) {
    val colorScheme = MaterialTheme.colorScheme
    Surface(
        checked = pressed,
        onCheckedChange = onPressedChange,
        modifier = modifier.semantics { role = Role.Checkbox },
        enabled = enabled,
        shape = AedstShapesScale.medium,
        color = if (pressed) colorScheme.surfaceVariant else Color.Transparent,
        contentColor = if (pressed) colorScheme.onSurface else colorScheme.onSurfaceVariant,
        border = if (variant == AedstToggleVariant.OUTLINE) BorderStroke(AedstHairline, colorScheme.outline) else null,
    ) {
        Row(
            modifier = Modifier
                .defaultMinSize(minWidth = size.minSize, minHeight = size.minSize)
                .padding(horizontal = AedstSpacing.sm),
            horizontalArrangement = Arrangement.spacedBy(AedstSpacing.xs, Alignment.CenterHorizontally),
            verticalAlignment = Alignment.CenterVertically,
            content = content,
        )
    }
}

@Preview(name = "Light", showBackground = true)
@Preview(name = "Dark", uiMode = Configuration.UI_MODE_NIGHT_YES, showBackground = true)
@Composable
private fun AedstTogglePreview() {
    var pressed by remember { mutableStateOf(true) }
    AedstTheme {
        Surface {
            Row(
                modifier = Modifier.padding(AedstSpacing.lg),
                horizontalArrangement = Arrangement.spacedBy(AedstSpacing.sm),
            ) {
                AedstToggleVariant.entries.forEach { variant ->
                    AedstToggle(pressed = pressed, onPressedChange = { pressed = it }, variant = variant) {
                        Icon(Icons.Default.Star, contentDescription = null)
                        Text("Starred")
                    }
                }
            }
        }
    }
}
