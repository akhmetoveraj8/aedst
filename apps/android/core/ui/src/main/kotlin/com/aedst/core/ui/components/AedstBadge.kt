package com.aedst.core.ui.components

import android.content.res.Configuration
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import com.aedst.core.ui.theme.AedstDarkPalette
import com.aedst.core.ui.theme.AedstLightPalette
import com.aedst.core.ui.theme.AedstShapesScale
import com.aedst.core.ui.theme.AedstSpacing
import com.aedst.core.ui.theme.AedstTheme
import com.aedst.core.ui.theme.LocalAedstDarkTheme

/** Visual treatment of [AedstBadge], mirroring web's `badge.tsx` `variant` prop. */
enum class AedstBadgeVariant {
    DEFAULT,
    SECONDARY,
    DESTRUCTIVE,
    SUCCESS,
    WARNING,
    INFO,
    OUTLINE,
    GHOST,
    LINK,
}

private data class AedstBadgeColors(val container: Color, val content: Color, val border: BorderStroke?)

private fun filled(container: Color, content: Color) = AedstBadgeColors(container, content, border = null)

@Composable
private fun colorsFor(variant: AedstBadgeVariant): AedstBadgeColors {
    val colorScheme = MaterialTheme.colorScheme
    val isDark = LocalAedstDarkTheme.current
    return when (variant) {
        AedstBadgeVariant.SUCCESS -> if (isDark) {
            filled(AedstDarkPalette.success, AedstDarkPalette.successForeground)
        } else {
            filled(AedstLightPalette.success, AedstLightPalette.successForeground)
        }

        AedstBadgeVariant.WARNING -> if (isDark) {
            filled(AedstDarkPalette.warning, AedstDarkPalette.warningForeground)
        } else {
            filled(AedstLightPalette.warning, AedstLightPalette.warningForeground)
        }

        AedstBadgeVariant.INFO -> if (isDark) {
            filled(AedstDarkPalette.info, AedstDarkPalette.infoForeground)
        } else {
            filled(AedstLightPalette.info, AedstLightPalette.infoForeground)
        }

        AedstBadgeVariant.GHOST -> filled(Color.Transparent, colorScheme.onSurface)

        AedstBadgeVariant.LINK -> filled(Color.Transparent, colorScheme.primary)

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
            textDecoration = if (variant == AedstBadgeVariant.LINK) TextDecoration.Underline else null,
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
            FlowRow(
                modifier = Modifier.padding(AedstSpacing.lg),
                horizontalArrangement = Arrangement.spacedBy(AedstSpacing.sm),
                verticalArrangement = Arrangement.spacedBy(AedstSpacing.sm),
            ) {
                AedstBadgeVariant.entries.forEach { AedstBadge(text = it.name.lowercase(), variant = it) }
            }
        }
    }
}
