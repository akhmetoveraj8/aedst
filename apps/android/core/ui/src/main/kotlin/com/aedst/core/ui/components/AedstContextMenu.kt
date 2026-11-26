package com.aedst.core.ui.components

import android.content.res.Configuration
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.CustomAccessibilityAction
import androidx.compose.ui.semantics.customActions
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.tooling.preview.Preview
import com.aedst.core.ui.R
import com.aedst.core.ui.theme.AedstSpacing
import com.aedst.core.ui.theme.AedstTheme

/** Tone of an [AedstContextMenuItem], mirroring web's `ContextMenuItem` `variant`. */
enum class AedstContextMenuItemVariant {
    DEFAULT,

    /** Label and icon in the destructive color. */
    DESTRUCTIVE,
}

/** One entry of an [AedstContextMenu] (web `ContextMenuItem`). */
data class AedstContextMenuItem<T>(
    val value: T,
    val label: String,
    val icon: (@Composable () -> Unit)? = null,
    val variant: AedstContextMenuItemVariant = AedstContextMenuItemVariant.DEFAULT,
    val enabled: Boolean = true,
)

/**
 * Long-press menu around [content], mirroring web's `context-menu.tsx` (right click there, touch-and-hold here).
 * The menu itself is [AedstDropdownMenu]. Screen-reader and switch users reach it through an "Open menu" custom
 * accessibility action on the content, since they cannot long-press.
 */
@Composable
fun <T> AedstContextMenu(
    options: List<AedstContextMenuItem<T>>,
    onOptionSelected: (T) -> Unit,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
    content: @Composable () -> Unit,
) {
    var expanded by remember { mutableStateOf(false) }
    val menuOptions = remember(options) { options.map { it.toDropdownOption() } }
    val openLabel = stringResource(R.string.aedst_a11y_open_menu)
    val trigger = if (enabled) {
        Modifier
            .pointerInput(Unit) { detectTapGestures(onLongPress = { expanded = true }) }
            .semantics {
                customActions = listOf(
                    CustomAccessibilityAction(openLabel) {
                        expanded = true
                        true
                    },
                )
            }
    } else {
        Modifier
    }
    Box(modifier = modifier.then(trigger)) {
        content()
        AedstDropdownMenu(
            expanded = expanded,
            onDismissRequest = { expanded = false },
            options = menuOptions,
            onOptionSelected = onOptionSelected,
        )
    }
}

private fun <T> AedstContextMenuItem<T>.toDropdownOption() = AedstDropdownMenuOption(
    value = value,
    label = label,
    icon = icon,
    variant = when (variant) {
        AedstContextMenuItemVariant.DEFAULT -> AedstDropdownMenuItemVariant.DEFAULT
        AedstContextMenuItemVariant.DESTRUCTIVE -> AedstDropdownMenuItemVariant.DESTRUCTIVE
    },
    enabled = enabled,
)

@Preview(name = "Light", showBackground = true)
@Preview(name = "Dark", uiMode = Configuration.UI_MODE_NIGHT_YES, showBackground = true)
@Composable
private fun AedstContextMenuPreview() {
    AedstTheme {
        Surface {
            AedstContextMenu(
                options = listOf(
                    AedstContextMenuItem(value = "rename", label = "Rename"),
                    AedstContextMenuItem(
                        value = "delete",
                        label = "Delete",
                        variant = AedstContextMenuItemVariant.DESTRUCTIVE,
                    ),
                ),
                onOptionSelected = {},
            ) {
                Text("Touch and hold", modifier = Modifier.padding(AedstSpacing.lg))
            }
        }
    }
}
