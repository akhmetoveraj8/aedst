package com.aedst.core.ui.components

import android.content.res.Configuration
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.runtime.movableContentOf
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.tooling.preview.Preview
import com.aedst.core.ui.theme.AedstSpacing
import com.aedst.core.ui.theme.AedstTheme

/** Axis of an [AedstButtonGroup], mirroring web's `button-group.tsx` `orientation` prop. */
enum class AedstButtonGroupOrientation {
    HORIZONTAL,
    VERTICAL,
}

/**
 * Lays related buttons out as one tight group, mirroring web's `button-group.tsx`. The buttons keep their own shape
 * and 48dp touch targets, so the group uses a small gap instead of fused borders.
 */
@Composable
fun AedstButtonGroup(
    modifier: Modifier = Modifier,
    orientation: AedstButtonGroupOrientation = AedstButtonGroupOrientation.HORIZONTAL,
    content: @Composable () -> Unit,
) {
    // One movable slot for both layouts: the buttons keep their state when the orientation changes.
    val buttons = remember(content) { movableContentOf(content) }
    when (orientation) {
        AedstButtonGroupOrientation.HORIZONTAL -> Row(
            modifier = modifier,
            horizontalArrangement = Arrangement.spacedBy(AedstSpacing.xxs),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            buttons()
        }

        AedstButtonGroupOrientation.VERTICAL -> Column(
            modifier = modifier,
            verticalArrangement = Arrangement.spacedBy(AedstSpacing.xxs),
        ) {
            buttons()
        }
    }
}

@Preview(name = "Light", showBackground = true)
@Preview(name = "Dark", uiMode = Configuration.UI_MODE_NIGHT_YES, showBackground = true)
@Composable
private fun AedstButtonGroupPreview() {
    AedstTheme {
        Surface {
            AedstButtonGroup(modifier = Modifier.padding(AedstSpacing.lg)) {
                AedstButton(text = "Day", onClick = {}, variant = AedstButtonVariant.OUTLINE)
                AedstButton(text = "Week", onClick = {}, variant = AedstButtonVariant.OUTLINE)
                AedstButton(text = "Month", onClick = {}, variant = AedstButtonVariant.OUTLINE)
            }
        }
    }
}
