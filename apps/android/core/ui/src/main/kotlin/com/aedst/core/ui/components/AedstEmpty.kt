package com.aedst.core.ui.components

import android.content.res.Configuration
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Search
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.tooling.preview.Preview
import com.aedst.core.ui.theme.AedstShapesScale
import com.aedst.core.ui.theme.AedstSpacing
import com.aedst.core.ui.theme.AedstTheme

/** Treatment of the media slot of [AedstEmpty], mirroring web's `empty.tsx` `EmptyMedia` `variant` prop. */
enum class AedstEmptyVariant {
    /** The media is shown as passed (an illustration, an avatar). */
    DEFAULT,

    /** The media is an icon on a muted rounded tile. */
    ICON,
}

/**
 * Empty state: centred media, title, description and actions, mirroring web's `empty.tsx`. Use it for "no results",
 * "nothing here yet" and first-run placeholders.
 */
@Composable
fun AedstEmpty(
    title: String,
    modifier: Modifier = Modifier,
    description: String? = null,
    variant: AedstEmptyVariant = AedstEmptyVariant.DEFAULT,
    media: (@Composable () -> Unit)? = null,
    actions: (@Composable RowScope.() -> Unit)? = null,
) {
    Column(
        modifier = modifier.fillMaxWidth().padding(AedstSpacing.xxl),
        verticalArrangement = Arrangement.spacedBy(AedstSpacing.sm),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        if (media != null) {
            when (variant) {
                AedstEmptyVariant.DEFAULT -> media()
                AedstEmptyVariant.ICON -> Box(
                    modifier = Modifier
                        .size(AedstSpacing.huge)
                        .background(MaterialTheme.colorScheme.surfaceVariant, AedstShapesScale.large),
                    contentAlignment = Alignment.Center,
                ) {
                    media()
                }
            }
        }
        Text(
            text = title,
            style = MaterialTheme.typography.titleSmall,
            textAlign = TextAlign.Center,
            modifier = Modifier.semantics { heading() },
        )
        if (description != null) {
            Text(
                text = description,
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                textAlign = TextAlign.Center,
            )
        }
        if (actions != null) {
            Row(
                modifier = Modifier.padding(top = AedstSpacing.sm),
                horizontalArrangement = Arrangement.spacedBy(AedstSpacing.sm),
                content = actions,
            )
        }
    }
}

@Preview(name = "Light", showBackground = true)
@Preview(name = "Dark", uiMode = Configuration.UI_MODE_NIGHT_YES, showBackground = true)
@Composable
private fun AedstEmptyPreview() {
    AedstTheme {
        Surface {
            AedstEmpty(
                title = "No tasks yet",
                description = "Create the first task to get started.",
                variant = AedstEmptyVariant.ICON,
                media = { Icon(Icons.Default.Search, contentDescription = null) },
                actions = { AedstButton(text = "New task", onClick = {}) },
            )
        }
    }
}
