package com.aedst.core.ui.components

import android.content.res.Configuration
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ArrowDropDown
import androidx.compose.material.icons.filled.Check
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import com.aedst.core.ui.theme.AedstShapesScale
import com.aedst.core.ui.theme.AedstSpacing
import com.aedst.core.ui.theme.AedstTheme

/**
 * Density of an [AedstNativeSelect] field, mirroring web's `native-select.tsx` `size`. Both keep the 48dp touch
 * target (web keeps 44px on coarse pointers); SM uses smaller text, padding and corners.
 */
enum class AedstNativeSelectSize { DEFAULT, SM }

/**
 * The platform-style picker, mirroring web's `native-select.tsx` (there the browser's own `<select>`): a field that
 * opens a modal single-choice list, the Android pattern for a system spinner in dialog mode. Prefer it over
 * [AedstSelect] for long option lists and on small screens, where an anchored menu is cramped. [label] titles the
 * dialog and names the field; [placeholder] is shown while nothing is selected.
 */
@Composable
fun <T> AedstNativeSelect(
    options: List<T>,
    selected: T?,
    onSelectedChange: (T) -> Unit,
    optionLabel: (T) -> String,
    label: String,
    placeholder: String,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
    size: AedstNativeSelectSize = AedstNativeSelectSize.DEFAULT,
) {
    var open by rememberSaveable { mutableStateOf(false) }
    Box(modifier = modifier.fillMaxWidth()) {
        NativeSelectField(
            text = selected?.let(optionLabel) ?: placeholder,
            label = label,
            isPlaceholder = selected == null,
            enabled = enabled,
            compact = size == AedstNativeSelectSize.SM,
            onClick = { open = true },
        )
        if (open) {
            OptionsDialog(label, onDismissRequest = { open = false }) {
                options.forEach { option ->
                    AedstItem(
                        title = optionLabel(option),
                        modifier = Modifier.semantics { this.selected = option == selected },
                        onClick = {
                            onSelectedChange(option)
                            open = false
                        },
                        actions = if (option == selected) {
                            { Icon(Icons.Default.Check, contentDescription = null) }
                        } else {
                            null
                        },
                    )
                }
            }
        }
    }
}

@Composable
private fun NativeSelectField(
    text: String,
    label: String,
    isPlaceholder: Boolean,
    enabled: Boolean,
    compact: Boolean,
    onClick: () -> Unit,
) {
    val colorScheme = MaterialTheme.colorScheme
    Surface(
        onClick = onClick,
        modifier = Modifier
            .fillMaxWidth()
            .semantics {
                role = Role.DropdownList
                contentDescription = label
            },
        enabled = enabled,
        shape = if (compact) AedstShapesScale.small else AedstShapesScale.medium,
        color = colorScheme.surface,
        contentColor = if (enabled) colorScheme.onSurface else colorScheme.onSurfaceVariant,
        border = BorderStroke(1.dp, colorScheme.outline),
    ) {
        Row(
            modifier = Modifier.heightIn(
                min = 48.dp,
            ).padding(horizontal = if (compact) AedstSpacing.sm else AedstSpacing.md),
            horizontalArrangement = Arrangement.spacedBy(AedstSpacing.sm),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(
                text = text,
                style = if (compact) MaterialTheme.typography.bodyMedium else MaterialTheme.typography.bodyLarge,
                color = if (isPlaceholder) colorScheme.onSurfaceVariant else colorScheme.onSurface,
                modifier = Modifier.weight(1f),
            )
            Icon(Icons.Default.ArrowDropDown, contentDescription = null)
        }
    }
}

@Composable
private fun OptionsDialog(title: String, onDismissRequest: () -> Unit, options: @Composable () -> Unit) {
    AedstDialog(onDismissRequest = onDismissRequest) {
        Text(text = title, style = MaterialTheme.typography.titleMedium)
        Column(
            modifier = Modifier
                .padding(top = AedstSpacing.sm)
                .heightIn(max = MAX_LIST_HEIGHT)
                .verticalScroll(rememberScrollState()),
        ) {
            options()
        }
    }
}

private val MAX_LIST_HEIGHT = 400.dp

@Preview(name = "Light", showBackground = true)
@Preview(name = "Dark", uiMode = Configuration.UI_MODE_NIGHT_YES, showBackground = true)
@Composable
private fun AedstNativeSelectPreview() {
    AedstTheme {
        Surface {
            AedstNativeSelect(
                options = listOf("English", "Russian", "Tajik", "Uzbek", "Arabic"),
                selected = "Tajik",
                onSelectedChange = {},
                optionLabel = { it },
                label = "Language",
                placeholder = "Choose a language",
                modifier = Modifier.padding(AedstSpacing.lg),
            )
        }
    }
}
