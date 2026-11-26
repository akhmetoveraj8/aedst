package com.aedst.core.ui.components

import android.content.res.Configuration
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ProvideTextStyle
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.RectangleShape
import androidx.compose.ui.graphics.Shape
import androidx.compose.ui.layout.layout
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import com.aedst.core.ui.components.support.bubbleColors
import com.aedst.core.ui.theme.AedstShapesScale
import com.aedst.core.ui.theme.AedstSpacing
import com.aedst.core.ui.theme.AedstTheme
import kotlin.math.roundToInt

/** Fill of an [AedstBubble], mirroring web's `bubble.tsx` `variant`. */
enum class AedstBubbleVariant { DEFAULT, SECONDARY, MUTED, TINTED, OUTLINE, GHOST, DESTRUCTIVE }

/** Edge of the bubble the [AedstBubbleReactions] pill overlaps (web `BubbleReactions` `side`). */
enum class AedstBubbleSide { TOP, BOTTOM }

/** Horizontal placement of a bubble, or of its reactions pill (web `align`); follows the layout direction. */
enum class AedstBubbleAlign { START, END }

/** Stack of consecutive bubbles from one sender (web `BubbleGroup`). */
@Composable
fun AedstBubbleGroup(modifier: Modifier = Modifier, content: @Composable ColumnScope.() -> Unit) {
    Column(modifier = modifier, verticalArrangement = Arrangement.spacedBy(AedstSpacing.sm), content = content)
}

/**
 * A chat bubble, mirroring web's `Bubble` + `BubbleContent`: at most 80 % of the available width (full width for
 * [AedstBubbleVariant.GHOST]). With [align] it takes the full width and sits at that edge; when null it wraps its
 * content and the parent's horizontal alignment places it (an [AedstMessage] aligns its content to its side). With
 * [onClick] the bubble is a button (web renders `BubbleContent` as a `button`) with at least a 48dp touch target.
 * [reactions] (usually [AedstBubbleReactions]) overlap the [reactionsSide] edge at [reactionsAlign]; leave room.
 */
@Composable
fun AedstBubble(
    modifier: Modifier = Modifier,
    variant: AedstBubbleVariant = AedstBubbleVariant.DEFAULT,
    align: AedstBubbleAlign? = null,
    onClick: (() -> Unit)? = null,
    reactions: (@Composable () -> Unit)? = null,
    reactionsSide: AedstBubbleSide = AedstBubbleSide.BOTTOM,
    reactionsAlign: AedstBubbleAlign = AedstBubbleAlign.END,
    content: @Composable ColumnScope.() -> Unit,
) {
    val ghost = variant == AedstBubbleVariant.GHOST
    Box(
        modifier = if (align == null) modifier else modifier.fillMaxWidth(),
        contentAlignment = if (align == AedstBubbleAlign.END) Alignment.TopEnd else Alignment.TopStart,
    ) {
        Box(modifier = Modifier.maxWidthFraction(if (ghost) 1f else MAX_WIDTH_FRACTION)) {
            BubbleContent(variant = variant, onClick = onClick, content = content)
            if (reactions != null) {
                val corner = when (reactionsSide) {
                    AedstBubbleSide.TOP -> if (reactionsAlign ==
                        AedstBubbleAlign.END
                    ) {
                        Alignment.TopEnd
                    } else {
                        Alignment.TopStart
                    }
                    AedstBubbleSide.BOTTOM ->
                        if (reactionsAlign == AedstBubbleAlign.END) Alignment.BottomEnd else Alignment.BottomStart
                }
                Box(
                    modifier = Modifier
                        .align(corner)
                        .padding(horizontal = AedstSpacing.md)
                        .overhang(reactionsSide),
                ) { reactions() }
            }
        }
    }
}

@Composable
private fun BubbleContent(
    variant: AedstBubbleVariant,
    onClick: (() -> Unit)?,
    content: @Composable ColumnScope.() -> Unit,
) {
    val colors = bubbleColors(variant)
    val ghost = variant == AedstBubbleVariant.GHOST
    val shape: Shape = if (ghost) RectangleShape else AedstShapesScale.extraLarge
    val padding = if (ghost) {
        PaddingValues()
    } else {
        PaddingValues(
            horizontal = AedstSpacing.md,
            vertical = AedstSpacing.sm,
        )
    }
    val body: @Composable () -> Unit = {
        ProvideTextStyle(MaterialTheme.typography.bodyMedium) {
            Column(modifier = Modifier.padding(padding), verticalArrangement = Arrangement.spacedBy(AedstSpacing.xs)) {
                content()
            }
        }
    }
    val border = colors.border?.let { BorderStroke(1.dp, it) }
    if (onClick == null) {
        Surface(shape = shape, color = colors.container, contentColor = colors.content, border = border, content = body)
    } else {
        Surface(
            onClick = onClick,
            modifier = Modifier
                .heightIn(min = 48.dp) // allow-dp: minimum touch target
                .semantics { role = Role.Button },
            shape = shape,
            color = colors.container,
            contentColor = colors.content,
            border = border,
            content = { Box(contentAlignment = Alignment.CenterStart) { body() } },
        )
    }
}

/** Emoji reactions pill of an [AedstBubble] (web `BubbleReactions`), ringed in the surface color. */
@Composable
fun AedstBubbleReactions(modifier: Modifier = Modifier, content: @Composable RowScope.() -> Unit) {
    Surface(
        modifier = modifier,
        shape = AedstShapesScale.pill,
        color = MaterialTheme.colorScheme.surfaceVariant,
        contentColor = MaterialTheme.colorScheme.onSurface,
        border = BorderStroke(RING, MaterialTheme.colorScheme.surface),
    ) {
        ProvideTextStyle(MaterialTheme.typography.bodyMedium) {
            Row(
                modifier = Modifier.padding(horizontal = AedstSpacing.sm, vertical = AedstSpacing.xxs),
                horizontalArrangement = Arrangement.spacedBy(AedstSpacing.xs),
                verticalAlignment = Alignment.CenterVertically,
                content = content,
            )
        }
    }
}

/** Caps the width at [fraction] of the incoming maximum while keeping the content's own (smaller) width. */
private fun Modifier.maxWidthFraction(fraction: Float): Modifier = layout { measurable, constraints ->
    val maxWidth = if (constraints.hasBoundedWidth) {
        (constraints.maxWidth * fraction).roundToInt()
    } else {
        constraints.maxWidth
    }
    val placeable = measurable.measure(constraints.copy(minWidth = 0, maxWidth = maxWidth))
    layout(placeable.width, placeable.height) { placeable.place(0, 0) }
}

/** Moves the pill three quarters of its height over the [side] edge, as web's `translate-y-3/4`. */
private fun Modifier.overhang(side: AedstBubbleSide): Modifier = layout { measurable, constraints ->
    val placeable = measurable.measure(constraints)
    val shift = (placeable.height * OVERHANG).roundToInt()
    layout(placeable.width, placeable.height) {
        placeable.place(0, if (side == AedstBubbleSide.BOTTOM) shift else -shift)
    }
}

private const val MAX_WIDTH_FRACTION = 0.8f
private const val OVERHANG = 0.75f
private val RING = 3.dp // allow-dp: web ring-3 around the reactions pill

@Preview(name = "Light", showBackground = true)
@Preview(name = "Dark", uiMode = Configuration.UI_MODE_NIGHT_YES, showBackground = true)
@Composable
private fun AedstBubblePreview() {
    AedstTheme {
        Surface {
            AedstBubbleGroup(modifier = Modifier.padding(AedstSpacing.lg)) {
                AedstBubbleVariant.entries.forEach { variant ->
                    AedstBubble(
                        variant = variant,
                        align = if (variant.ordinal % 2 == 0) AedstBubbleAlign.START else AedstBubbleAlign.END,
                    ) { Text(variant.name.lowercase()) }
                }
                Box(Modifier.padding(bottom = AedstSpacing.md)) {
                    AedstBubble(reactions = { AedstBubbleReactions { Text("👍 2") } }) { Text("Ship it?") }
                }
            }
        }
    }
}
