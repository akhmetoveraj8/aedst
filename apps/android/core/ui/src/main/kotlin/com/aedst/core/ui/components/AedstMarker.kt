package com.aedst.core.ui.components

import android.content.res.Configuration
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
import androidx.compose.material.icons.filled.Info
import androidx.compose.material3.Icon
import androidx.compose.material3.LocalContentColor
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import com.aedst.core.ui.theme.AedstSpacing
import com.aedst.core.ui.theme.AedstTheme

/** Look of an [AedstMarker], mirroring web's `marker.tsx` `variant`. */
enum class AedstMarkerVariant {
    /** Icon and text only. */
    DEFAULT,

    /** Centred text between two hairlines (a date or "new messages" divider). */
    SEPARATOR,

    /** Text above a hairline. */
    BORDER,
}

/**
 * A quiet inline note in a conversation or list ("Today", "Ada joined", "Edited"), mirroring web's `Marker`. Compose
 * [AedstMarkerIcon] and [AedstMarkerContent] in [content]. The marker is read as one item by screen readers; the icon
 * is decorative.
 */
@Composable
fun AedstMarker(
    modifier: Modifier = Modifier,
    variant: AedstMarkerVariant = AedstMarkerVariant.DEFAULT,
    content: @Composable RowScope.() -> Unit,
) {
    val border = MaterialTheme.colorScheme.outlineVariant
    val base = modifier
        .fillMaxWidth()
        .heightIn(min = AedstSpacing.lg)
        .semantics(mergeDescendants = true) {}
    val decorated = if (variant == AedstMarkerVariant.BORDER) {
        base
            .drawBehind {
                val y = size.height - HAIRLINE.toPx() / 2
                drawLine(border, Offset(0f, y), Offset(size.width, y), HAIRLINE.toPx())
            }
            .padding(bottom = AedstSpacing.sm)
    } else {
        base
    }
    CompositionLocalProvider(LocalContentColor provides MaterialTheme.colorScheme.onSurfaceVariant) {
        Row(
            modifier = decorated,
            horizontalArrangement = Arrangement.spacedBy(AedstSpacing.sm),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            // One call site for the slot, so its state survives a variant change; only the rules come and go.
            val isSeparator = variant == AedstMarkerVariant.SEPARATOR
            if (isSeparator) MarkerRule(Modifier.weight(1f).padding(end = AedstSpacing.xs))
            content()
            if (isSeparator) MarkerRule(Modifier.weight(1f).padding(start = AedstSpacing.xs))
        }
    }
}

/** Decorative 16dp icon of an [AedstMarker] (web `MarkerIcon`, `aria-hidden`). */
@Composable
fun AedstMarkerIcon(modifier: Modifier = Modifier, icon: @Composable () -> Unit) {
    Box(
        modifier = modifier.size(AedstSpacing.lg).clearAndSetSemantics {},
        contentAlignment = Alignment.Center,
    ) { icon() }
}

/** Text of an [AedstMarker] (web `MarkerContent`). */
@Composable
fun AedstMarkerContent(text: String, modifier: Modifier = Modifier) {
    Text(
        text = text,
        modifier = modifier,
        style = MaterialTheme.typography.bodyMedium,
        textAlign = TextAlign.Center,
    )
}

@Composable
private fun MarkerRule(modifier: Modifier = Modifier) {
    val color = MaterialTheme.colorScheme.outlineVariant
    Box(
        modifier = modifier
            .heightIn(min = HAIRLINE)
            .drawBehind {
                drawLine(color, Offset(0f, size.height / 2), Offset(size.width, size.height / 2), HAIRLINE.toPx())
            },
    )
}

private val HAIRLINE = 1.dp // allow-dp: hairline rule, web h-px / border-b

@Preview(name = "Light", showBackground = true)
@Preview(name = "Dark", uiMode = Configuration.UI_MODE_NIGHT_YES, showBackground = true)
@Composable
private fun AedstMarkerPreview() {
    AedstTheme {
        Surface {
            Column(
                modifier = Modifier.padding(AedstSpacing.lg),
                verticalArrangement = Arrangement.spacedBy(AedstSpacing.lg),
            ) {
                AedstMarker {
                    AedstMarkerIcon { Icon(Icons.Default.Info, contentDescription = null) }
                    AedstMarkerContent("Ada joined the conversation")
                }
                AedstMarker(variant = AedstMarkerVariant.SEPARATOR) { AedstMarkerContent("Today") }
                AedstMarker(variant = AedstMarkerVariant.BORDER) { AedstMarkerContent("Earlier messages") }
            }
        }
    }
}
