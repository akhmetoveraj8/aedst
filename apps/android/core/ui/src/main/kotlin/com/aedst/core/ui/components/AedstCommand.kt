package com.aedst.core.ui.components

import android.content.res.Configuration
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Search
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.tooling.preview.Preview
import com.aedst.core.ui.theme.AedstHairline
import com.aedst.core.ui.theme.AedstShapesScale
import com.aedst.core.ui.theme.AedstSpacing
import com.aedst.core.ui.theme.AedstTheme

/** One runnable entry of an [AedstCommand]. [shortcut] is a hardware-keyboard hint shown as key caps text. */
class AedstCommandItem(
    val id: String,
    val label: String,
    val shortcut: String? = null,
    val icon: (@Composable () -> Unit)? = null,
)

/** A titled group of [AedstCommandItem]s. */
class AedstCommandGroup(val heading: String, val items: List<AedstCommandItem>)

/**
 * Command list with a search field, mirroring web's `command.tsx` (the inline form; put it in `AedstDialog` for a
 * command palette). Typing filters items by a case-insensitive substring of their label; groups with no match
 * disappear and [emptyText] is shown when nothing is left. [searchLabel] names the search field.
 */
@Composable
fun AedstCommand(
    groups: List<AedstCommandGroup>,
    onItemSelected: (AedstCommandItem) -> Unit,
    searchLabel: String,
    emptyText: String,
    modifier: Modifier = Modifier,
) {
    var query by rememberSaveable { mutableStateOf("") }
    val visible = groups.mapNotNull { group ->
        val items = group.items.filter { it.label.contains(query.trim(), ignoreCase = true) }
        if (items.isEmpty()) null else group.heading to items
    }
    Surface(
        modifier = modifier,
        shape = AedstShapesScale.large,
        border = BorderStroke(AedstHairline, MaterialTheme.colorScheme.outlineVariant),
    ) {
        Column(modifier = Modifier.padding(AedstSpacing.sm)) {
            AedstTextField(
                value = query,
                onValueChange = { query = it },
                modifier = Modifier.fillMaxWidth(),
                placeholder = searchLabel,
                label = searchLabel,
                leadingIcon = { Icon(Icons.Default.Search, contentDescription = null) },
            )
            if (visible.isEmpty()) {
                Text(
                    text = emptyText,
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.padding(AedstSpacing.md),
                )
            }
            visible.forEach { (heading, items) ->
                Text(
                    text = heading,
                    style = MaterialTheme.typography.labelMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier
                        .padding(horizontal = AedstSpacing.md, vertical = AedstSpacing.sm)
                        .semantics { heading() },
                )
                items.forEach { item ->
                    AedstItem(
                        title = item.label,
                        size = AedstItemSize.SM,
                        mediaVariant = AedstItemMediaVariant.ICON,
                        onClick = { onItemSelected(item) },
                        media = item.icon,
                        actions = item.shortcut?.let { { AedstKbd(it) } },
                    )
                }
            }
        }
    }
}

@Preview(name = "Light", showBackground = true)
@Preview(name = "Dark", uiMode = Configuration.UI_MODE_NIGHT_YES, showBackground = true)
@Composable
private fun AedstCommandPreview() {
    AedstTheme {
        Surface {
            AedstCommand(
                groups = listOf(
                    AedstCommandGroup(
                        "Tasks",
                        listOf(AedstCommandItem("new", "New task", shortcut = "N"), AedstCommandItem("find", "Find")),
                    ),
                    AedstCommandGroup("Account", listOf(AedstCommandItem("out", "Sign out"))),
                ),
                onItemSelected = {},
                searchLabel = "Search commands",
                emptyText = "No results",
                modifier = Modifier.padding(AedstSpacing.lg),
            )
        }
    }
}
