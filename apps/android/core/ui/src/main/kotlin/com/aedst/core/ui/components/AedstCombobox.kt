package com.aedst.core.ui.components

import android.content.res.Configuration
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ExposedDropdownMenu
import androidx.compose.material3.ExposedDropdownMenuAnchorType
import androidx.compose.material3.ExposedDropdownMenuBox
import androidx.compose.material3.ExposedDropdownMenuDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.disabled
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.tooling.preview.Preview
import com.aedst.core.ui.theme.AedstShapesScale
import com.aedst.core.ui.theme.AedstSpacing
import com.aedst.core.ui.theme.AedstTheme

/**
 * Select with type-to-filter over an option type [T], mirroring web's `combobox.tsx`. Built on Material 3
 * [ExposedDropdownMenuBox] with an editable anchor: typing narrows the list (case-insensitive substring of
 * [optionLabel]); picking an option reports it and writes its label into the field. [emptyText] is shown when
 * nothing matches.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun <T> AedstCombobox(
    options: List<T>,
    selected: T?,
    onSelectedChange: (T) -> Unit,
    optionLabel: (T) -> String,
    emptyText: String,
    modifier: Modifier = Modifier,
    label: String? = null,
    placeholder: String? = null,
    enabled: Boolean = true,
) {
    var expanded by remember { mutableStateOf(false) }
    var query by remember(selected) { mutableStateOf(selected?.let(optionLabel).orEmpty()) }
    val selectedLabel = selected?.let(optionLabel)
    // An untouched field (still showing the selection) lists everything; a typed query filters.
    val matches = if (query.isBlank() || query == selectedLabel) {
        options
    } else {
        options.filter { optionLabel(it).contains(query, ignoreCase = true) }
    }

    ExposedDropdownMenuBox(
        expanded = expanded,
        onExpandedChange = { if (enabled) expanded = it },
        modifier = modifier.fillMaxWidth().semantics { if (!enabled) disabled() },
    ) {
        OutlinedTextField(
            value = query,
            onValueChange = {
                query = it
                expanded = true
            },
            modifier = Modifier.fillMaxWidth().menuAnchor(ExposedDropdownMenuAnchorType.PrimaryEditable, enabled),
            enabled = enabled,
            singleLine = true,
            label = label?.let { { Text(it) } },
            placeholder = placeholder?.let { { Text(it) } },
            trailingIcon = { ExposedDropdownMenuDefaults.TrailingIcon(expanded = expanded) },
            shape = AedstShapesScale.medium,
        )
        ExposedDropdownMenu(expanded = expanded, onDismissRequest = { expanded = false }) {
            if (matches.isEmpty()) {
                Text(
                    text = emptyText,
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.padding(AedstSpacing.md),
                )
            }
            matches.forEach { option ->
                DropdownMenuItem(
                    text = { Text(optionLabel(option)) },
                    onClick = {
                        onSelectedChange(option)
                        query = optionLabel(option)
                        expanded = false
                    },
                )
            }
        }
    }
}

@Preview(name = "Light")
@Preview(name = "Dark", uiMode = Configuration.UI_MODE_NIGHT_YES)
@Composable
private fun AedstComboboxPreview() {
    AedstTheme {
        Surface(color = MaterialTheme.colorScheme.background) {
            AedstCombobox(
                options = listOf("Dushanbe", "Tashkent", "Almaty"),
                selected = "Tashkent",
                onSelectedChange = {},
                optionLabel = { it },
                emptyText = "No city found",
                modifier = Modifier.padding(AedstSpacing.lg),
                label = "City",
            )
        }
    }
}
