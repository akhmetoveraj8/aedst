package com.aedst.core.ui.components

import android.content.res.Configuration
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.selection.selectableGroup
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Home
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import com.aedst.core.ui.theme.AedstShapesScale
import com.aedst.core.ui.theme.AedstSpacing
import com.aedst.core.ui.theme.AedstTheme
import com.aedst.core.ui.theme.AedstThemeExtras

/** Visual treatment of [AedstSidebarMenuButton], mirroring web's `sidebarMenuButtonVariants` `variant`. */
enum class AedstSidebarMenuButtonVariant {
    DEFAULT,
    OUTLINE,
}

/** Height of [AedstSidebarMenuButton], mirroring web's `sidebarMenuButtonVariants` `size`. */
enum class AedstSidebarMenuButtonSize(internal val minHeight: Dp) {
    DEFAULT(48.dp),
    SM(48.dp),
    LG(56.dp),
}

/**
 * Persistent navigation column for wide windows, mirroring web's `sidebar/` (the panel, its header, scrolling content
 * and footer), drawn with the `sidebar*` tokens. It is the panel only: showing it as a rail, a drawer or not at all
 * per window size is the screen's job (`rememberAedstWidthClass`). Fill [content] with [AedstSidebarMenuButton]s.
 */
@Composable
fun AedstSidebar(
    modifier: Modifier = Modifier,
    header: (@Composable ColumnScope.() -> Unit)? = null,
    footer: (@Composable ColumnScope.() -> Unit)? = null,
    content: @Composable ColumnScope.() -> Unit,
) {
    val colors = AedstThemeExtras.extendedColors
    Surface(
        modifier = modifier.width(SIDEBAR_WIDTH).fillMaxHeight(),
        color = colors.sidebar,
        contentColor = colors.sidebarForeground,
        border = BorderStroke(1.dp, colors.sidebarBorder),
    ) {
        Column(modifier = Modifier.padding(AedstSpacing.sm)) {
            if (header != null) header()
            Column(
                modifier = Modifier
                    .weight(1f)
                    .verticalScroll(rememberScrollState())
                    .selectableGroup(),
                verticalArrangement = Arrangement.spacedBy(AedstSpacing.xxs),
                content = content,
            )
            if (footer != null) footer()
        }
    }
}

/** One destination row of an [AedstSidebar]. [selected] marks the current destination. */
@Composable
fun AedstSidebarMenuButton(
    label: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    selected: Boolean = false,
    variant: AedstSidebarMenuButtonVariant = AedstSidebarMenuButtonVariant.DEFAULT,
    size: AedstSidebarMenuButtonSize = AedstSidebarMenuButtonSize.DEFAULT,
    icon: (@Composable () -> Unit)? = null,
) {
    val colors = AedstThemeExtras.extendedColors
    Surface(
        selected = selected,
        onClick = onClick,
        modifier = modifier.fillMaxWidth().semantics { role = Role.Tab },
        shape = AedstShapesScale.medium,
        color = if (selected) colors.sidebarAccent else Color.Transparent,
        contentColor = if (selected) colors.sidebarAccentForeground else colors.sidebarForeground,
        border = if (variant == AedstSidebarMenuButtonVariant.OUTLINE) {
            BorderStroke(1.dp, colors.sidebarBorder)
        } else {
            null
        },
    ) {
        Row(
            modifier = Modifier.heightIn(min = size.minHeight).padding(horizontal = AedstSpacing.sm),
            horizontalArrangement = Arrangement.spacedBy(AedstSpacing.sm),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            icon?.invoke()
            Text(
                text = label,
                style = if (size == AedstSidebarMenuButtonSize.SM) {
                    MaterialTheme.typography.labelMedium
                } else {
                    MaterialTheme.typography.labelLarge
                },
            )
        }
    }
}

private val SIDEBAR_WIDTH = 256.dp

@Preview(name = "Light", showBackground = true, heightDp = 320)
@Preview(name = "Dark", uiMode = Configuration.UI_MODE_NIGHT_YES, showBackground = true, heightDp = 320)
@Composable
private fun AedstSidebarPreview() {
    AedstTheme {
        Surface {
            AedstSidebar(
                header = { Text("AEDST", modifier = Modifier.padding(AedstSpacing.sm)) },
                footer = { Text("v1.0", modifier = Modifier.padding(AedstSpacing.sm)) },
            ) {
                AedstSidebarMenuButton(label = "Home", onClick = {}, selected = true) {
                    Icon(Icons.Default.Home, contentDescription = null)
                }
                AedstSidebarMenuButton(
                    label = "Settings",
                    onClick = {},
                    variant = AedstSidebarMenuButtonVariant.OUTLINE,
                ) {
                    Icon(Icons.Default.Settings, contentDescription = null)
                }
            }
        }
    }
}
