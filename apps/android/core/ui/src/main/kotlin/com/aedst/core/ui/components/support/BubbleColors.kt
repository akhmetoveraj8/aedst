package com.aedst.core.ui.components.support

import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.Immutable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.lerp
import com.aedst.core.ui.components.AedstBubbleVariant
import com.aedst.core.ui.theme.LocalAedstDarkTheme

/** Container, content and optional border colors of an [AedstBubbleVariant]. */
@Immutable
internal class BubbleColors(val container: Color, val content: Color, val border: Color?)

/**
 * The colors of each bubble variant from the theme tokens, as web's `bubble.tsx`: TINTED mixes a little primary into
 * the background (web derives it from primary in OKLCH), DESTRUCTIVE is a translucent destructive fill with
 * destructive text.
 */
@Composable
internal fun bubbleColors(variant: AedstBubbleVariant): BubbleColors {
    val scheme = MaterialTheme.colorScheme
    val dark = LocalAedstDarkTheme.current
    return when (variant) {
        AedstBubbleVariant.DEFAULT -> BubbleColors(scheme.primary, scheme.onPrimary, null)
        AedstBubbleVariant.SECONDARY -> BubbleColors(scheme.secondary, scheme.onSecondary, null)
        AedstBubbleVariant.MUTED -> BubbleColors(scheme.surfaceVariant, scheme.onSurface, null)
        AedstBubbleVariant.TINTED -> BubbleColors(
            container = lerp(scheme.background, scheme.primary, if (dark) TINT_DARK else TINT_LIGHT),
            content = scheme.onBackground,
            border = null,
        )
        AedstBubbleVariant.OUTLINE -> BubbleColors(scheme.background, scheme.onBackground, scheme.outlineVariant)
        AedstBubbleVariant.GHOST -> BubbleColors(Color.Transparent, scheme.onSurface, null)
        AedstBubbleVariant.DESTRUCTIVE -> BubbleColors(
            container = scheme.error.copy(alpha = if (dark) DESTRUCTIVE_DARK else DESTRUCTIVE_LIGHT),
            content = scheme.error,
            border = null,
        )
    }
}

private const val TINT_LIGHT = 0.08f
private const val TINT_DARK = 0.2f
private const val DESTRUCTIVE_LIGHT = 0.1f
private const val DESTRUCTIVE_DARK = 0.2f
