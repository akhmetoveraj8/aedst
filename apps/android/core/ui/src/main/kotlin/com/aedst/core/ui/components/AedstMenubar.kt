package com.aedst.core.ui.components

import android.content.res.Configuration
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.tooling.preview.Preview
import com.aedst.core.ui.R
import com.aedst.core.ui.theme.AedstSpacing
import com.aedst.core.ui.theme.AedstTheme

/** One top-level menu of an [AedstMenubar] and the options it opens. */
class AedstMenubarMenu<T>(val label: String, val options: List<AedstDropdownMenuOption<T>>)

/**
 * A row of menu triggers, each opening an [AedstDropdownMenu], mirroring web's `menubar.tsx` (for tablet, desktop
 * mode and hardware-keyboard layouts; a phone screen usually wants one overflow menu instead). Only one menu is open
 * at a time; the row scrolls horizontally when it does not fit.
 */
@Composable
fun <T> AedstMenubar(menus: List<AedstMenubarMenu<T>>, onOptionSelected: (T) -> Unit, modifier: Modifier = Modifier) {
    var openIndex by rememberSaveable { mutableStateOf<Int?>(null) }
    Row(
        modifier = modifier.horizontalScroll(rememberScrollState()),
        horizontalArrangement = Arrangement.spacedBy(AedstSpacing.xxs),
    ) {
        menus.forEachIndexed { index, menu ->
            val isOpen = openIndex == index
            val state = stringResource(if (isOpen) R.string.aedst_a11y_expanded else R.string.aedst_a11y_collapsed)
            Box {
                AedstButton(
                    text = menu.label,
                    onClick = { openIndex = if (isOpen) null else index },
                    modifier = Modifier.semantics { stateDescription = state },
                    variant = AedstButtonVariant.GHOST,
                    size = AedstButtonSize.SM,
                )
                AedstDropdownMenu(
                    expanded = isOpen,
                    onDismissRequest = { openIndex = null },
                    options = menu.options,
                    onOptionSelected = onOptionSelected,
                )
            }
        }
    }
}

@Preview(name = "Light", showBackground = true)
@Preview(name = "Dark", uiMode = Configuration.UI_MODE_NIGHT_YES, showBackground = true)
@Composable
private fun AedstMenubarPreview() {
    AedstTheme {
        Surface {
            AedstMenubar(
                menus = listOf(
                    AedstMenubarMenu("File", listOf(AedstDropdownMenuOption("new", "New"))),
                    AedstMenubarMenu("Edit", listOf(AedstDropdownMenuOption("undo", "Undo"))),
                ),
                onOptionSelected = {},
                modifier = Modifier.padding(AedstSpacing.sm),
            )
        }
    }
}
