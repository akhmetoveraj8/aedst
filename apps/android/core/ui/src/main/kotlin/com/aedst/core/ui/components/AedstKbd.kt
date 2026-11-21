package com.aedst.core.ui.components

import android.content.res.Configuration
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import com.aedst.core.ui.theme.AedstShapesScale
import com.aedst.core.ui.theme.AedstSpacing
import com.aedst.core.ui.theme.AedstTheme

/** A keyboard key cap (for hardware-keyboard shortcut hints), mirroring web's `kbd.tsx`. */
@Composable
fun AedstKbd(text: String, modifier: Modifier = Modifier) {
    Surface(
        modifier = modifier,
        shape = AedstShapesScale.small,
        color = MaterialTheme.colorScheme.surfaceVariant,
        contentColor = MaterialTheme.colorScheme.onSurfaceVariant,
        border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant),
    ) {
        Text(
            text = text,
            style = MaterialTheme.typography.labelSmall,
            fontFamily = FontFamily.Monospace,
            modifier = Modifier.padding(horizontal = AedstSpacing.xs, vertical = AedstSpacing.xxs),
        )
    }
}

@Preview(name = "Light", showBackground = true)
@Preview(name = "Dark", uiMode = Configuration.UI_MODE_NIGHT_YES, showBackground = true)
@Composable
private fun AedstKbdPreview() {
    AedstTheme {
        Surface {
            Row(
                modifier = Modifier.padding(AedstSpacing.lg),
                horizontalArrangement = Arrangement.spacedBy(AedstSpacing.xs),
            ) {
                AedstKbd("Ctrl")
                AedstKbd("K")
            }
        }
    }
}
