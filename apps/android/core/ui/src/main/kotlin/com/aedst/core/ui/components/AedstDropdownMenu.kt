package com.aedst.core.ui.components

import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Check
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.tooling.preview.Preview
import com.aedst.core.ui.theme.AedstTheme

/** A single selectable entry in [AedstDropdownMenu]. */
data class AedstDropdownMenuOption<T>(
    val value: T,
    val label: String,
    val icon: (@Composable () -> Unit)? = null,
    val isDestructive: Boolean = false,
)

/**
 * Menu-item dropdown, mirroring web's `dropdown-menu.tsx`. Thin wrapper over Material3's
 * [DropdownMenu] + [DropdownMenuItem], with destructive options tinted with the theme's error
 * color.
 */
@Composable
fun <T> AedstDropdownMenu(
    expanded: Boolean,
    onDismissRequest: () -> Unit,
    options: List<AedstDropdownMenuOption<T>>,
    onOptionSelected: (T) -> Unit,
    modifier: Modifier = Modifier,
) {
    DropdownMenu(
        expanded = expanded,
        onDismissRequest = onDismissRequest,
        modifier = modifier,
    ) {
        options.forEach { option ->
            val contentColor = if (option.isDestructive) {
                MaterialTheme.colorScheme.error
            } else {
                MaterialTheme.colorScheme.onSurface
            }
            DropdownMenuItem(
                text = { Text(option.label, color = contentColor) },
                onClick = {
                    onDismissRequest()
                    onOptionSelected(option.value)
                },
                leadingIcon = option.icon,
            )
        }
    }
}

@Preview(name = "Light", showBackground = true)
@Preview(name = "Dark", showBackground = true, uiMode = android.content.res.Configuration.UI_MODE_NIGHT_YES)
@Composable
private fun AedstDropdownMenuPreview() {
    AedstTheme {
        Surface(color = MaterialTheme.colorScheme.background) {
            AedstDropdownMenu(
                expanded = true,
                onDismissRequest = {},
                options = listOf(
                    AedstDropdownMenuOption(
                        value = "mark_done",
                        label = "Mark as done",
                        icon = { androidx.compose.material3.Icon(Icons.Default.Check, contentDescription = null) },
                    ),
                    AedstDropdownMenuOption(value = "duplicate", label = "Duplicate"),
                    AedstDropdownMenuOption(value = "delete", label = "Delete", isDestructive = true),
                ),
                onOptionSelected = {},
            )
        }
    }
}
