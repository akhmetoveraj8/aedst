package com.aedst.core.ui.components

import android.content.res.Configuration
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Person
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import com.aedst.core.ui.theme.AedstShapesScale
import com.aedst.core.ui.theme.AedstSpacing
import com.aedst.core.ui.theme.AedstTheme

/** Container treatment of [AedstItem], mirroring web's `item.tsx` `variant` prop. */
enum class AedstItemVariant {
    DEFAULT,
    OUTLINE,
    MUTED,
}

/** Treatment of the media slot of [AedstItem], mirroring web's `ItemMedia` `variant` prop. */
enum class AedstItemMediaVariant {
    DEFAULT,
    ICON,
    IMAGE,
}

/** Density of [AedstItem], mirroring web's `item.tsx` `size` prop; also sizes an `IMAGE` media slot. */
enum class AedstItemSize(internal val padding: Dp, internal val imageSize: Dp) {
    DEFAULT(12.dp, 40.dp),
    SM(8.dp, 32.dp),
    XS(4.dp, 24.dp),
}

/**
 * A row of media, title, description and trailing actions, mirroring web's `item.tsx`: the building block of lists,
 * settings rows and pickers. With [onClick] the whole row is one button (at least 48dp tall).
 */
@Composable
fun AedstItem(
    title: String,
    modifier: Modifier = Modifier,
    description: String? = null,
    variant: AedstItemVariant = AedstItemVariant.DEFAULT,
    size: AedstItemSize = AedstItemSize.DEFAULT,
    mediaVariant: AedstItemMediaVariant = AedstItemMediaVariant.DEFAULT,
    onClick: (() -> Unit)? = null,
    media: (@Composable () -> Unit)? = null,
    actions: (@Composable RowScope.() -> Unit)? = null,
) {
    val colorScheme = MaterialTheme.colorScheme
    Surface(
        modifier = modifier.fillMaxWidth(),
        shape = AedstShapesScale.large,
        color = if (variant == AedstItemVariant.MUTED) colorScheme.surfaceVariant else Color.Transparent,
        contentColor = colorScheme.onSurface,
        border = if (variant == AedstItemVariant.OUTLINE) BorderStroke(1.dp, colorScheme.outlineVariant) else null,
    ) {
        val click = if (onClick != null) Modifier.clickable(role = Role.Button, onClick = onClick) else Modifier
        Row(
            modifier = click
                .heightIn(min = 48.dp)
                .padding(horizontal = AedstSpacing.md, vertical = size.padding),
            horizontalArrangement = Arrangement.spacedBy(AedstSpacing.md),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            if (media != null) ItemMedia(mediaVariant, size, media)
            Column(modifier = Modifier.weight(1f)) {
                Text(text = title, style = MaterialTheme.typography.labelLarge)
                if (description != null) {
                    Text(
                        text = description,
                        style = MaterialTheme.typography.bodySmall,
                        color = colorScheme.onSurfaceVariant,
                    )
                }
            }
            if (actions != null) {
                Row(
                    horizontalArrangement = Arrangement.spacedBy(AedstSpacing.sm),
                    verticalAlignment = Alignment.CenterVertically,
                    content = actions,
                )
            }
        }
    }
}

@Composable
private fun ItemMedia(variant: AedstItemMediaVariant, size: AedstItemSize, media: @Composable () -> Unit) {
    val modifier = when (variant) {
        AedstItemMediaVariant.DEFAULT -> Modifier
        AedstItemMediaVariant.ICON -> Modifier.size(16.dp)
        AedstItemMediaVariant.IMAGE -> Modifier.size(size.imageSize).clip(AedstShapesScale.small)
    }
    Box(modifier = modifier, contentAlignment = Alignment.Center) { media() }
}

@Preview(name = "Light", showBackground = true)
@Preview(name = "Dark", uiMode = Configuration.UI_MODE_NIGHT_YES, showBackground = true)
@Composable
private fun AedstItemPreview() {
    AedstTheme {
        Surface {
            Column(
                modifier = Modifier.padding(AedstSpacing.lg),
                verticalArrangement = Arrangement.spacedBy(AedstSpacing.sm),
            ) {
                AedstItemVariant.entries.forEach { variant ->
                    AedstItem(
                        title = "Ada Lovelace",
                        description = "ada@example.com",
                        variant = variant,
                        mediaVariant = AedstItemMediaVariant.ICON,
                        onClick = {},
                        media = { Icon(Icons.Default.Person, contentDescription = null) },
                        actions = { AedstBadge(text = "Owner") },
                    )
                }
            }
        }
    }
}
