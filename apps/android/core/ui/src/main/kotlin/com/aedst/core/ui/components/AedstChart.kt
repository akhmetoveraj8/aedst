package com.aedst.core.ui.components

import android.content.res.Configuration
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.scale
import androidx.compose.ui.platform.LocalLayoutDirection
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.LayoutDirection
import androidx.compose.ui.unit.dp
import com.aedst.core.ui.theme.AedstShapesScale
import com.aedst.core.ui.theme.AedstSpacing
import com.aedst.core.ui.theme.AedstTheme
import com.aedst.core.ui.theme.AedstThemeExtras

/** How [AedstChart] draws its series. */
enum class AedstChartType {
    BAR,
    LINE,
}

/** One named series of an [AedstChart]; every series has one value per category. */
class AedstChartSeries(val label: String, val values: List<Float>)

/**
 * Minimal bar / line chart with a legend, mirroring the container + legend part of web's `chart.tsx`. Web wraps
 * Recharts; no chart library is approved for Android, so this draws up to five non-negative series on a Canvas with
 * the `chart1..5` tokens and nothing more (no axes, tooltips, stacking or negative values: those need an owner
 * decision on a library). The drawing is one accessibility node named by [contentDescription]; put the numbers a
 * screen-reader user needs into that description or next to the chart.
 */
@Composable
fun AedstChart(
    series: List<AedstChartSeries>,
    contentDescription: String,
    modifier: Modifier = Modifier,
    type: AedstChartType = AedstChartType.BAR,
) {
    val colors = AedstThemeExtras.extendedColors.chartColors
    val grid = MaterialTheme.colorScheme.outlineVariant
    val isRtl = LocalLayoutDirection.current == LayoutDirection.Rtl
    Column(modifier = modifier, verticalArrangement = Arrangement.spacedBy(AedstSpacing.sm)) {
        Canvas(
            modifier = Modifier
                .fillMaxWidth()
                .height(160.dp)
                .semantics { this.contentDescription = contentDescription },
        ) {
            val max = series.maxOfOrNull { it.values.maxOrNull() ?: 0f }?.takeIf { it > 0f } ?: return@Canvas
            val shown = series.take(colors.size)
            drawLine(grid, Offset(0f, size.height), Offset(size.width, size.height), strokeWidth = 1.dp.toPx())
            // Categories run from the start edge: mirror the whole plot in RTL.
            scale(scaleX = if (isRtl) -1f else 1f, scaleY = 1f) {
                shown.forEachIndexed { index, item ->
                    when (type) {
                        AedstChartType.BAR -> drawBars(item.values, index, shown.size, max, colors[index])
                        AedstChartType.LINE -> drawSeriesLine(item.values, max, colors[index])
                    }
                }
            }
        }
        FlowRow(horizontalArrangement = Arrangement.spacedBy(AedstSpacing.md)) {
            series.take(colors.size).forEachIndexed { index, item ->
                Row(
                    horizontalArrangement = Arrangement.spacedBy(AedstSpacing.xs),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Box(Modifier.size(8.dp).background(colors[index], AedstShapesScale.small))
                    Text(
                        text = item.label,
                        style = MaterialTheme.typography.labelMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }
        }
    }
}

private fun DrawScope.drawBars(values: List<Float>, seriesIndex: Int, seriesCount: Int, max: Float, color: Color) {
    if (values.isEmpty()) return
    val slot = size.width / values.size
    val bar = slot * BAR_FILL / seriesCount
    values.forEachIndexed { index, value ->
        val left = index * slot + slot * (1f - BAR_FILL) / 2f + seriesIndex * bar
        val height = size.height * (value.coerceAtLeast(0f) / max)
        drawRect(color, topLeft = Offset(left, size.height - height), size = Size(bar, height))
    }
}

private fun DrawScope.drawSeriesLine(values: List<Float>, max: Float, color: Color) {
    if (values.size < 2) return
    val points = values.mapIndexed { index, value ->
        Offset(
            x = size.width * index / (values.size - 1),
            y = size.height * (1f - value.coerceAtLeast(0f) / max),
        )
    }
    points.zipWithNext().forEach { (from, to) ->
        drawLine(color, from, to, strokeWidth = 2.dp.toPx(), cap = StrokeCap.Round)
    }
}

private const val BAR_FILL = 0.8f

@Preview(name = "Light", showBackground = true)
@Preview(name = "Dark", uiMode = Configuration.UI_MODE_NIGHT_YES, showBackground = true)
@Composable
private fun AedstChartPreview() {
    val series = listOf(
        AedstChartSeries("Created", listOf(4f, 7f, 5f, 9f)),
        AedstChartSeries("Done", listOf(2f, 6f, 5f, 7f)),
    )
    AedstTheme {
        Surface {
            Column(
                modifier = Modifier.padding(AedstSpacing.lg),
                verticalArrangement = Arrangement.spacedBy(AedstSpacing.lg),
            ) {
                AedstChartType.entries.forEach { type ->
                    AedstChart(series = series, contentDescription = "Tasks per week", type = type)
                }
            }
        }
    }
}
