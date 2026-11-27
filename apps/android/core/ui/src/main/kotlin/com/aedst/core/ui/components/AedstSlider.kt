package com.aedst.core.ui.components

import android.content.res.Configuration
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Slider
import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.tooling.preview.Preview
import com.aedst.core.ui.theme.AedstSpacing
import com.aedst.core.ui.theme.AedstTheme

/**
 * Single-value slider, mirroring web's `slider.tsx`. Thin wrapper over Material 3 [Slider], which exposes the range
 * (`progressBarRangeInfo`), the current value and the set-progress action to accessibility services. [contentDescription]
 * only names the control; the value is never folded into it, so the screen reader announces it from the range info.
 * Pass [valueText] ("40 %", "3 of 5") to replace the default percentage with a spoken value (`stateDescription`).
 * The track is mirrored in right-to-left layouts. The slider is at least 48dp tall, so the whole track row is the
 * touch target around its thumb. [steps] is the number of discrete stops between the ends (0 = continuous).
 */
@Composable
fun AedstSlider(
    value: Float,
    onValueChange: (Float) -> Unit,
    contentDescription: String,
    modifier: Modifier = Modifier,
    valueRange: ClosedFloatingPointRange<Float> = 0f..1f,
    steps: Int = 0,
    enabled: Boolean = true,
    valueText: ((Float) -> String)? = null,
    onValueChangeFinished: (() -> Unit)? = null,
) {
    val spoken = valueText?.invoke(value)
    Slider(
        value = value,
        onValueChange = onValueChange,
        modifier = modifier.semantics {
            this.contentDescription = contentDescription
            if (spoken != null) stateDescription = spoken
        },
        enabled = enabled,
        valueRange = valueRange,
        steps = steps,
        onValueChangeFinished = onValueChangeFinished,
    )
}

@Preview(name = "Light", showBackground = true)
@Preview(name = "Dark", uiMode = Configuration.UI_MODE_NIGHT_YES, showBackground = true)
@Composable
private fun AedstSliderPreview() {
    var value by remember { mutableFloatStateOf(0.4f) }
    AedstTheme {
        Surface {
            AedstSlider(
                value = value,
                onValueChange = { value = it },
                contentDescription = "Volume",
                modifier = Modifier.padding(AedstSpacing.lg),
            )
        }
    }
}
