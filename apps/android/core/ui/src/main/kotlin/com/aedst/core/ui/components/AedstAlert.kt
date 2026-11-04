package com.aedst.core.ui.components

import android.content.res.Configuration
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.Info
import androidx.compose.material.icons.filled.Warning
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import com.aedst.core.ui.theme.AedstDarkPalette
import com.aedst.core.ui.theme.AedstLightPalette
import com.aedst.core.ui.theme.AedstShapesScale
import com.aedst.core.ui.theme.AedstSpacing
import com.aedst.core.ui.theme.AedstTheme
import com.aedst.core.ui.theme.LocalAedstDarkTheme

/** Visual treatment of [AedstAlert], mirroring web's `alert.tsx` `variant` prop. */
enum class AedstAlertVariant {
    INFO,
    SUCCESS,
    WARNING,
    DESTRUCTIVE,
}

private data class AedstAlertPalette(
    val container: Color,
    val border: Color,
    val icon: Color,
    val title: Color,
    val description: Color,
)

@Composable
private fun rememberAlertPalette(variant: AedstAlertVariant): AedstAlertPalette {
    val colorScheme = MaterialTheme.colorScheme
    val isDark = LocalAedstDarkTheme.current
    return when (variant) {
        AedstAlertVariant.INFO -> AedstAlertPalette(
            container = colorScheme.secondary.copy(alpha = 0.14f),
            border = colorScheme.secondary.copy(alpha = 0.4f),
            icon = colorScheme.secondary,
            title = colorScheme.onSurface,
            description = colorScheme.onSurfaceVariant,
        )

        AedstAlertVariant.SUCCESS -> {
            val tint = if (isDark) AedstDarkPalette.success else AedstLightPalette.success
            AedstAlertPalette(
                container = tint.copy(alpha = 0.14f),
                border = tint.copy(alpha = 0.4f),
                icon = tint,
                title = colorScheme.onSurface,
                description = colorScheme.onSurfaceVariant,
            )
        }

        AedstAlertVariant.WARNING -> {
            val tint = if (isDark) AedstDarkPalette.warning else AedstLightPalette.warning
            AedstAlertPalette(
                container = tint.copy(alpha = 0.14f),
                border = tint.copy(alpha = 0.4f),
                icon = tint,
                title = colorScheme.onSurface,
                description = colorScheme.onSurfaceVariant,
            )
        }

        AedstAlertVariant.DESTRUCTIVE -> AedstAlertPalette(
            container = colorScheme.errorContainer,
            border = colorScheme.error,
            icon = colorScheme.error,
            title = colorScheme.onErrorContainer,
            description = colorScheme.onErrorContainer.copy(alpha = 0.85f),
        )
    }
}

private fun defaultIconFor(variant: AedstAlertVariant): ImageVector = when (variant) {
    AedstAlertVariant.SUCCESS -> Icons.Default.Check
    AedstAlertVariant.WARNING -> Icons.Default.Warning
    // "Error" is not part of material-icons-core; Warning doubles as the destructive glyph.
    AedstAlertVariant.DESTRUCTIVE -> Icons.Default.Warning
    AedstAlertVariant.INFO -> Icons.Default.Info
}

/**
 * Inline alert banner, mirroring web's `alert.tsx`. Announces itself as a polite live region so
 * screen readers pick up alerts that appear after the initial composition (e.g. form validation).
 * [actions] adds a row of buttons under the text (retry, dismiss); use the `Aedst*` buttons there.
 */
@Composable
fun AedstAlert(
    title: String,
    modifier: Modifier = Modifier,
    description: String? = null,
    variant: AedstAlertVariant = AedstAlertVariant.INFO,
    icon: (@Composable () -> Unit)? = null,
    actions: (@Composable RowScope.() -> Unit)? = null,
) {
    val palette = rememberAlertPalette(variant)

    Surface(
        modifier = modifier
            .fillMaxWidth()
            .semantics { liveRegion = LiveRegionMode.Polite },
        shape = AedstShapesScale.medium,
        color = palette.container,
        border = BorderStroke(1.dp, palette.border),
    ) {
        Row(
            modifier = Modifier.padding(AedstSpacing.md),
            horizontalArrangement = Arrangement.spacedBy(AedstSpacing.sm),
        ) {
            if (icon != null) {
                icon()
            } else {
                Icon(
                    imageVector = defaultIconFor(variant),
                    contentDescription = null,
                    tint = palette.icon,
                    modifier = Modifier.size(20.dp),
                )
            }
            Column {
                Text(
                    text = title,
                    color = palette.title,
                    style = MaterialTheme.typography.titleSmall,
                )
                if (description != null) {
                    Text(
                        text = description,
                        color = palette.description,
                        style = MaterialTheme.typography.bodySmall,
                    )
                }
                if (actions != null) {
                    Row(
                        horizontalArrangement = Arrangement.spacedBy(AedstSpacing.sm),
                        modifier = Modifier.padding(top = AedstSpacing.sm),
                        content = actions,
                    )
                }
            }
        }
    }
}

@Preview(name = "Light")
@Preview(name = "Dark", uiMode = Configuration.UI_MODE_NIGHT_YES)
@Composable
private fun AedstAlertPreview() {
    AedstTheme {
        Surface {
            Column(
                modifier = Modifier.padding(AedstSpacing.lg),
                verticalArrangement = Arrangement.spacedBy(AedstSpacing.sm),
            ) {
                AedstAlert(
                    title = "Heads up",
                    description = "This is an informational message.",
                    variant = AedstAlertVariant.INFO,
                )
                AedstAlert(
                    title = "Saved successfully",
                    description = "Your changes have been synced.",
                    variant = AedstAlertVariant.SUCCESS,
                )
                AedstAlert(
                    title = "Storage almost full",
                    description = "You are close to your plan limit.",
                    variant = AedstAlertVariant.WARNING,
                )
                AedstAlert(
                    title = "Action failed",
                    description = "Could not delete this task. Try again.",
                    variant = AedstAlertVariant.DESTRUCTIVE,
                )
            }
        }
    }
}
