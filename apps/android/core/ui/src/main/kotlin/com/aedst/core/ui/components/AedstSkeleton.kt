package com.aedst.core.ui.components

import android.content.res.Configuration
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Shape
import androidx.compose.ui.tooling.preview.Preview
import com.aedst.core.ui.a11y.rememberReducedMotion
import com.aedst.core.ui.theme.AedstShapesScale
import com.aedst.core.ui.theme.AedstSpacing
import com.aedst.core.ui.theme.AedstTheme

/**
 * Shimmering loading placeholder. The caller controls size entirely through [modifier] (no
 * default height is imposed) so this can stand in for anything from a text line to an avatar. With the system
 * "remove animations" setting on, it is a static block (no looping shimmer).
 */
@Composable
fun AedstSkeleton(modifier: Modifier = Modifier, shape: Shape = AedstShapesScale.medium) {
    val baseColor = MaterialTheme.colorScheme.surfaceVariant
    Box(modifier = modifier.clip(shape)) {
        if (rememberReducedMotion()) {
            Box(modifier = Modifier.fillMaxSize().background(baseColor))
        } else {
            SkeletonShimmer(baseColor)
        }
    }
}

@Composable
private fun SkeletonShimmer(baseColor: Color) {
    val highlightColor = baseColor.copy(alpha = 0.4f)
    val transition = rememberInfiniteTransition(label = "aedstSkeletonShimmer")
    val translateAnim by transition.animateFloat(
        initialValue = 0f,
        targetValue = SHIMMER_TRAVEL,
        animationSpec = infiniteRepeatable(
            animation = tween(durationMillis = SHIMMER_MILLIS, easing = LinearEasing),
            repeatMode = RepeatMode.Restart,
        ),
        label = "aedstSkeletonShimmerTranslate",
    )
    val brush = Brush.linearGradient(
        colors = listOf(baseColor, highlightColor, baseColor),
        start = Offset(translateAnim - SHIMMER_BAND, 0f),
        end = Offset(translateAnim, SHIMMER_BAND),
    )
    Box(modifier = Modifier.fillMaxSize().background(brush))
}

private const val SHIMMER_TRAVEL = 1000f
private const val SHIMMER_BAND = 200f
private const val SHIMMER_MILLIS = 1200

/**
 * Paragraph-style placeholder: stacks [lines] skeleton bars, with the last line trimmed to ~60%
 * width so multi-line text blocks read as naturally ragged rather than a solid rectangle.
 */
@Composable
fun AedstSkeletonText(modifier: Modifier = Modifier, lines: Int = 1) {
    Column(
        modifier = modifier,
        verticalArrangement = Arrangement.spacedBy(AedstSpacing.xs),
    ) {
        repeat(lines) { index ->
            val isTrailingLine = lines > 1 && index == lines - 1
            AedstSkeleton(
                modifier = Modifier
                    .fillMaxWidth(if (isTrailingLine) 0.6f else 1f)
                    .height(AedstSpacing.md),
            )
        }
    }
}

@Preview(name = "Light")
@Preview(name = "Dark", uiMode = Configuration.UI_MODE_NIGHT_YES)
@Composable
private fun AedstSkeletonPreview() {
    AedstTheme {
        Surface {
            Column(
                modifier = Modifier.padding(AedstSpacing.lg),
                verticalArrangement = Arrangement.spacedBy(AedstSpacing.md),
            ) {
                AedstSkeleton(
                    modifier = Modifier
                        .fillMaxWidth()
                        .height(AedstSpacing.lg),
                )
                AedstSkeletonText(lines = 3)
            }
        }
    }
}
