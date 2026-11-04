package com.aedst.core.ui.components

import android.content.res.Configuration
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
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
 * Dropdown select over an arbitrary option type [T], mirroring web's `select.tsx`. Built on
 * Material3's [ExposedDropdownMenuBox] with a read-only anchor field; options render via
 * [optionLabel] and the currently [selected] value is shown when non-null.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun <T> AedstSelect(
    options: List<T>,
    selected: T?,
    onSelectedChange: (T) -> Unit,
    optionLabel: (T) -> String,
    modifier: Modifier = Modifier,
    label: String? = null,
    enabled: Boolean = true,
    placeholder: String = "Select…",
) {
    var expanded by remember { mutableStateOf(false) }

    ExposedDropdownMenuBox(
        expanded = expanded,
        onExpandedChange = { if (enabled) expanded = it },
        modifier = modifier.fillMaxWidth().semantics { if (!enabled) disabled() },
    ) {
        OutlinedTextField(
            value = selected?.let(optionLabel).orEmpty(),
            onValueChange = {},
            modifier = Modifier.fillMaxWidth().menuAnchor(ExposedDropdownMenuAnchorType.PrimaryNotEditable, enabled),
            readOnly = true,
            enabled = enabled,
            label = label?.let { { Text(it) } },
            placeholder = { Text(placeholder) },
            trailingIcon = { ExposedDropdownMenuDefaults.TrailingIcon(expanded = expanded) },
            shape = AedstShapesScale.medium,
        )
        ExposedDropdownMenu(
            expanded = expanded,
            onDismissRequest = { expanded = false },
        ) {
            options.forEach { option ->
                DropdownMenuItem(
                    text = { Text(optionLabel(option)) },
                    onClick = {
                        onSelectedChange(option)
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
private fun AedstSelectPreview() {
    AedstTheme {
        Surface(color = MaterialTheme.colorScheme.background) {
            AedstSelect(
                options = listOf("Draft", "In review", "Published"),
                selected = "In review",
                onSelectedChange = {},
                modifier = Modifier.padding(AedstSpacing.lg),
                label = "Status",
                optionLabel = { it },
            )
        }
    }
}
