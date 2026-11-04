package com.aedst.core.ui.components

import android.content.res.Configuration
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.VerticalDivider
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import com.aedst.core.ui.theme.AedstSpacing
import com.aedst.core.ui.theme.AedstTheme

/** Axis a [AedstDivider] separates content along, mirroring web's `Separator` `orientation` prop. */
enum class AedstDividerOrientation {
    HORIZONTAL,
    VERTICAL,
}

/**
 * Thin wrapper over Material3's [HorizontalDivider]/[VerticalDivider] so every hairline in the
 * app draws from a single, themed call site.
 */
@Composable
fun AedstDivider(
    modifier: Modifier = Modifier,
    orientation: AedstDividerOrientation = AedstDividerOrientation.HORIZONTAL,
) {
    when (orientation) {
        AedstDividerOrientation.HORIZONTAL -> HorizontalDivider(
            modifier = modifier.fillMaxWidth(),
            color = MaterialTheme.colorScheme.outlineVariant,
        )

        AedstDividerOrientation.VERTICAL -> VerticalDivider(
            modifier = modifier.fillMaxHeight(),
            color = MaterialTheme.colorScheme.outlineVariant,
        )
    }
}

@Preview(name = "Light", showBackground = true)
@Preview(name = "Dark", uiMode = Configuration.UI_MODE_NIGHT_YES, showBackground = true)
@Composable
private fun AedstDividerPreview() {
    AedstTheme {
        Surface {
            Column(modifier = Modifier.padding(AedstSpacing.lg)) {
                Text("Above")
                AedstDivider(modifier = Modifier.padding(vertical = AedstSpacing.sm))
                Text("Below")
                Row(modifier = Modifier.height(24.dp).padding(top = AedstSpacing.sm)) {
                    Text("Left")
                    AedstDivider(
                        orientation = AedstDividerOrientation.VERTICAL,
                        modifier = Modifier.padding(horizontal = AedstSpacing.sm),
                    )
                    Text("Right")
                }
            }
        }
    }
}
