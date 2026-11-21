package com.aedst.core.ui.components

import android.content.res.Configuration
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.tooling.preview.Preview
import com.aedst.core.ui.theme.AedstSpacing
import com.aedst.core.ui.theme.AedstTheme

/**
 * A row of [AedstToggle]s over an option type [T], mirroring web's `toggle-group.tsx`. With [multiple] false at most
 * one option is pressed (pressing it again clears the selection); with [multiple] true each option toggles on its own.
 */
@Composable
fun <T> AedstToggleGroup(
    options: List<T>,
    selected: Set<T>,
    onSelectedChange: (Set<T>) -> Unit,
    optionLabel: (T) -> String,
    modifier: Modifier = Modifier,
    multiple: Boolean = false,
    variant: AedstToggleVariant = AedstToggleVariant.OUTLINE,
    size: AedstToggleSize = AedstToggleSize.DEFAULT,
    enabled: Boolean = true,
) {
    Row(modifier = modifier, horizontalArrangement = Arrangement.spacedBy(AedstSpacing.xs)) {
        options.forEach { option ->
            AedstToggle(
                pressed = option in selected,
                onPressedChange = { pressed ->
                    val next = when {
                        !pressed -> selected - option
                        multiple -> selected + option
                        else -> setOf(option)
                    }
                    onSelectedChange(next)
                },
                variant = variant,
                size = size,
                enabled = enabled,
            ) {
                Text(optionLabel(option))
            }
        }
    }
}

@Preview(name = "Light", showBackground = true)
@Preview(name = "Dark", uiMode = Configuration.UI_MODE_NIGHT_YES, showBackground = true)
@Composable
private fun AedstToggleGroupPreview() {
    var selected by remember { mutableStateOf(setOf("Day")) }
    AedstTheme {
        Surface {
            AedstToggleGroup(
                options = listOf("Day", "Week", "Month"),
                selected = selected,
                onSelectedChange = { selected = it },
                optionLabel = { it },
                modifier = Modifier.padding(AedstSpacing.lg),
            )
        }
    }
}
