package com.aedst.core.ui.components

import android.content.res.Configuration
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.tooling.preview.Preview
import com.aedst.core.ui.theme.AedstSpacing
import com.aedst.core.ui.theme.AedstTheme

/**
 * Selectable chip for choosing one value out of a few (priority, status). Feature code uses this instead of
 * Material3's `FilterChip` (enforced by the `ForbiddenImport/Material3Raw` detekt gate).
 */
@Composable
fun AedstFilterChip(
    selected: Boolean,
    onClick: () -> Unit,
    label: String,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
) {
    FilterChip(
        selected = selected,
        onClick = onClick,
        label = { Text(label) },
        modifier = modifier,
        enabled = enabled,
    )
}

@Preview(name = "Light", showBackground = true)
@Preview(name = "Dark", uiMode = Configuration.UI_MODE_NIGHT_YES, showBackground = true)
@Composable
private fun AedstFilterChipPreview() {
    AedstTheme {
        Surface {
            Row(modifier = Modifier.padding(AedstSpacing.md)) {
                AedstFilterChip(selected = true, onClick = {}, label = "High")
                AedstFilterChip(selected = false, onClick = {}, label = "Low")
            }
        }
    }
}
