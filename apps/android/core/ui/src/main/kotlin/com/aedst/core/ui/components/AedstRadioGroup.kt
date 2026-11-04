package com.aedst.core.ui.components

import android.content.res.Configuration
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.selection.selectableGroup
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.RadioButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.disabled
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.tooling.preview.Preview
import com.aedst.core.ui.theme.AedstSpacing
import com.aedst.core.ui.theme.AedstTheme

/**
 * Single-selection radio group over an arbitrary option type [T], mirroring web's
 * `radio-group.tsx`. The [Column] exposes `selectableGroup()` semantics and each row is
 * `selectable()` so screen readers announce group membership and selected state correctly.
 */
@Composable
fun <T> AedstRadioGroup(
    options: List<T>,
    selected: T,
    onSelectedChange: (T) -> Unit,
    optionLabel: (T) -> String,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
) {
    Column(
        modifier = modifier.selectableGroup(),
        verticalArrangement = Arrangement.spacedBy(AedstSpacing.xs),
    ) {
        options.forEach { option ->
            val isSelected = option == selected
            Row(
                modifier = Modifier
                    .selectable(
                        selected = isSelected,
                        enabled = enabled,
                        onClick = { onSelectedChange(option) },
                    )
                    .semantics { if (!enabled) disabled() },
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(AedstSpacing.sm),
            ) {
                RadioButton(selected = isSelected, onClick = null, enabled = enabled)
                Text(
                    text = optionLabel(option),
                    style = MaterialTheme.typography.bodyMedium,
                    color = if (enabled) {
                        MaterialTheme.colorScheme.onSurface
                    } else {
                        MaterialTheme.colorScheme.onSurfaceVariant
                    },
                )
            }
        }
    }
}

@Preview(name = "Light")
@Preview(name = "Dark", uiMode = Configuration.UI_MODE_NIGHT_YES)
@Composable
private fun AedstRadioGroupPreview() {
    AedstTheme {
        Surface(color = MaterialTheme.colorScheme.background) {
            AedstRadioGroup(
                options = listOf("Small", "Medium", "Large"),
                selected = "Medium",
                onSelectedChange = {},
                modifier = Modifier.padding(AedstSpacing.lg),
                optionLabel = { it },
            )
        }
    }
}
