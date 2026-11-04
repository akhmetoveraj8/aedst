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
import androidx.compose.ui.graphics.Shape
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import com.aedst.core.ui.theme.AedstShapesScale
import com.aedst.core.ui.theme.AedstSpacing
import com.aedst.core.ui.theme.AedstTheme

/**
 * Shimmering loading placeholder. The caller controls size entirely through [modifier] (no
 * default height is imposed) so this can stand in for anything from a text line to an avatar.
 */
@Composable
fun AedstSkeleton(modifier: Modifier = Modifier, shape: Shape = AedstShapesScale.medium) {
    val baseColor = MaterialTheme.colorScheme.surfaceVariant
    val highlightColor = baseColor.copy(alpha = 0.4f)
    val transition = rememberInfiniteTransition(label = "aedstSkeletonShimmer")
    val translateAnim by transition.animateFloat(
        initialValue = 0f,
        targetValue = 1000f,
        animationSpec = infiniteRepeatable(
            animation = tween(durationMillis = 1200, easing = LinearEasing),
            repeatMode = RepeatMode.Restart,
        ),
        label = "aedstSkeletonShimmerTranslate",
    )
    val brush = Brush.linearGradient(
        colors = listOf(baseColor, highlightColor, baseColor),
        start = Offset(translateAnim - 200f, 0f),
        end = Offset(translateAnim, 200f),
    )

    Box(
        modifier = modifier
            .clip(shape)
            .background(brush),
    )
}

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
                    .height(14.dp),
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
                        .height(16.dp),
                )
                AedstSkeletonText(lines = 3)
            }
        }
    }
}
