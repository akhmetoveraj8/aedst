package com.aedst.core.ui.components

import android.content.res.Configuration
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.ProgressBarRangeInfo
import androidx.compose.ui.semantics.progressBarRangeInfo
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import com.aedst.core.ui.theme.AedstSpacing
import com.aedst.core.ui.theme.AedstTheme

/**
 * Horizontal progress bar. A `null` [progress] renders the indeterminate (looping) Material3
 * animation; a non-null value in `0f..1f` renders a determinate bar and exposes
 * `progressBarRangeInfo` semantics for accessibility services.
 */
@Composable
fun AedstLinearProgressIndicator(progress: Float?, modifier: Modifier = Modifier) {
    val trackedModifier = modifier.fillMaxWidth().let { base ->
        if (progress != null) {
            base.semantics {
                progressBarRangeInfo = ProgressBarRangeInfo(progress.coerceIn(0f, 1f), 0f..1f)
            }
        } else {
            base
        }
    }
    if (progress != null) {
        LinearProgressIndicator(
            progress = { progress.coerceIn(0f, 1f) },
            modifier = trackedModifier,
        )
    } else {
        LinearProgressIndicator(modifier = trackedModifier)
    }
}

/**
 * Circular progress spinner. A `null` [progress] renders the indeterminate spinner; a non-null
 * value in `0f..1f` renders a determinate ring and exposes `progressBarRangeInfo` semantics.
 */
@Composable
fun AedstCircularProgressIndicator(progress: Float?, modifier: Modifier = Modifier, strokeWidth: Dp = 4.dp) {
    val trackedModifier = if (progress != null) {
        modifier.semantics {
            progressBarRangeInfo = ProgressBarRangeInfo(progress.coerceIn(0f, 1f), 0f..1f)
        }
    } else {
        modifier
    }
    if (progress != null) {
        CircularProgressIndicator(
            progress = { progress.coerceIn(0f, 1f) },
            modifier = trackedModifier,
            strokeWidth = strokeWidth,
        )
    } else {
        CircularProgressIndicator(modifier = trackedModifier, strokeWidth = strokeWidth)
    }
}

@Preview(name = "Light")
@Preview(name = "Dark", uiMode = Configuration.UI_MODE_NIGHT_YES)
@Composable
private fun AedstProgressIndicatorPreview() {
    AedstTheme {
        Surface {
            Column(modifier = Modifier.padding(AedstSpacing.lg)) {
                AedstLinearProgressIndicator(progress = 0.6f)
                AedstLinearProgressIndicator(
                    progress = null,
                    modifier = Modifier.padding(top = AedstSpacing.md),
                )
                AedstCircularProgressIndicator(
                    progress = 0.6f,
                    modifier = Modifier.padding(top = AedstSpacing.md),
                )
                AedstCircularProgressIndicator(
                    progress = null,
                    modifier = Modifier.padding(top = AedstSpacing.md),
                )
            }
        }
    }
}
