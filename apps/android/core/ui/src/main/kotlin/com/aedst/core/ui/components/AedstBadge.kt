package com.aedst.core.ui.components

import android.content.res.Configuration
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import com.aedst.core.ui.theme.AedstShapesScale
import com.aedst.core.ui.theme.AedstSpacing
import com.aedst.core.ui.theme.AedstTheme

/** Visual treatment of [AedstBadge], mirroring web's `badge.tsx` `variant` prop. */
enum class AedstBadgeVariant {
    DEFAULT,
    SECONDARY,
    DESTRUCTIVE,
    OUTLINE,
}

private data class AedstBadgeColors(val container: Color, val content: Color, val border: BorderStroke?)

@Composable
private fun colorsFor(variant: AedstBadgeVariant): AedstBadgeColors {
    val colorScheme = MaterialTheme.colorScheme
    return when (variant) {
        AedstBadgeVariant.DEFAULT -> AedstBadgeColors(
            container = colorScheme.primary,
            content = colorScheme.onPrimary,
            border = null,
        )

        AedstBadgeVariant.SECONDARY -> AedstBadgeColors(
            container = colorScheme.secondary,
            content = colorScheme.onSecondary,
            border = null,
        )

        AedstBadgeVariant.DESTRUCTIVE -> AedstBadgeColors(
            container = colorScheme.error,
            content = colorScheme.onError,
            border = null,
        )

        AedstBadgeVariant.OUTLINE -> AedstBadgeColors(
            container = colorScheme.surface,
            content = colorScheme.onSurface,
            border = BorderStroke(1.dp, colorScheme.outlineVariant),
        )
    }
}

/** Small status pill, mirroring web's `badge.tsx`. */
@Composable
fun AedstBadge(text: String, modifier: Modifier = Modifier, variant: AedstBadgeVariant = AedstBadgeVariant.DEFAULT) {
    val colors = colorsFor(variant)

    Surface(
        modifier = modifier,
        shape = AedstShapesScale.pill,
        color = colors.container,
        contentColor = colors.content,
        border = colors.border,
    ) {
        Text(
            text = text,
            style = MaterialTheme.typography.labelSmall,
            modifier = Modifier.padding(horizontal = AedstSpacing.sm, vertical = 2.dp),
        )
    }
}

@Preview(name = "Light")
@Preview(name = "Dark", uiMode = Configuration.UI_MODE_NIGHT_YES)
@Composable
private fun AedstBadgePreview() {
    AedstTheme {
        Surface {
            Row(
                modifier = Modifier.padding(AedstSpacing.lg),
                horizontalArrangement = Arrangement.spacedBy(AedstSpacing.sm),
            ) {
                AedstBadge(text = "Default", variant = AedstBadgeVariant.DEFAULT)
                AedstBadge(text = "Secondary", variant = AedstBadgeVariant.SECONDARY)
                AedstBadge(text = "Destructive", variant = AedstBadgeVariant.DESTRUCTIVE)
                AedstBadge(text = "Outline", variant = AedstBadgeVariant.OUTLINE)
            }
        }
    }
}
