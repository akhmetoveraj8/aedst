package com.aedst.core.ui.components

import android.content.res.Configuration
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.selection.toggleable
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.disabled
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.tooling.preview.Preview
import com.aedst.core.ui.theme.AedstSpacing
import com.aedst.core.ui.theme.AedstTheme

/**
 * Switch with an optional trailing [label], mirroring web's `switch.tsx`. Tapping the label
 * toggles the switch, matching [AedstCheckbox]'s row-as-target behavior.
 */
@Composable
fun AedstSwitch(
    checked: Boolean,
    onCheckedChange: (Boolean) -> Unit,
    modifier: Modifier = Modifier,
    label: String? = null,
    enabled: Boolean = true,
) {
    if (label == null) {
        Switch(
            checked = checked,
            onCheckedChange = onCheckedChange,
            modifier = modifier.semantics { if (!enabled) disabled() },
            enabled = enabled,
        )
        return
    }

    Row(
        modifier = modifier
            .toggleable(
                value = checked,
                enabled = enabled,
                role = Role.Switch,
                onValueChange = onCheckedChange,
            ),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(AedstSpacing.sm),
    ) {
        Text(
            text = label,
            style = MaterialTheme.typography.bodyMedium,
            color = if (enabled) {
                MaterialTheme.colorScheme.onSurface
            } else {
                MaterialTheme.colorScheme.onSurfaceVariant
            },
            modifier = Modifier.weight(1f, fill = false),
        )
        Switch(checked = checked, onCheckedChange = null, enabled = enabled)
    }
}

@Preview(name = "Light")
@Preview(name = "Dark", uiMode = Configuration.UI_MODE_NIGHT_YES)
@Composable
private fun AedstSwitchPreview() {
    AedstTheme {
        Surface(color = MaterialTheme.colorScheme.background) {
            Column(
                modifier = Modifier.padding(AedstSpacing.lg),
                verticalArrangement = Arrangement.spacedBy(AedstSpacing.sm),
            ) {
                AedstSwitch(checked = true, onCheckedChange = {}, label = "Enable notifications")
                AedstSwitch(checked = false, onCheckedChange = {}, label = "Dark mode")
                AedstSwitch(checked = false, onCheckedChange = {}, label = "Disabled", enabled = false)
            }
        }
    }
}
