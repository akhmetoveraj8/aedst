package com.aedst.core.ui.components

import android.content.res.Configuration
import androidx.compose.foundation.layout.Column
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.tooling.preview.Preview
import com.aedst.core.ui.theme.AedstTheme

/** One section of an [AedstAccordion]. [id] is stable across recompositions. */
class AedstAccordionItem(val id: String, val title: String, val content: @Composable () -> Unit)

/**
 * A stack of disclosures separated by hairlines, mirroring web's `accordion.tsx`. Built on [AedstCollapsible]. State
 * is hoisted as the set of expanded ids; with [multiple] false opening a section closes the others.
 */
@Composable
fun AedstAccordion(
    items: List<AedstAccordionItem>,
    expandedIds: Set<String>,
    onExpandedChange: (Set<String>) -> Unit,
    modifier: Modifier = Modifier,
    multiple: Boolean = false,
) {
    Column(modifier = modifier) {
        items.forEachIndexed { index, item ->
            if (index > 0) AedstDivider()
            AedstCollapsible(
                title = item.title,
                expanded = item.id in expandedIds,
                onExpandedChange = { expanded ->
                    val next = when {
                        !expanded -> expandedIds - item.id
                        multiple -> expandedIds + item.id
                        else -> setOf(item.id)
                    }
                    onExpandedChange(next)
                },
            ) {
                item.content()
            }
        }
    }
}

@Preview(name = "Light", showBackground = true)
@Preview(name = "Dark", uiMode = Configuration.UI_MODE_NIGHT_YES, showBackground = true)
@Composable
private fun AedstAccordionPreview() {
    var expanded by remember { mutableStateOf(setOf("shipping")) }
    AedstTheme {
        Surface {
            AedstAccordion(
                items = listOf(
                    AedstAccordionItem("shipping", "Shipping") { Text("Ships in two days.") },
                    AedstAccordionItem("returns", "Returns") { Text("Free returns for 30 days.") },
                ),
                expandedIds = expanded,
                onExpandedChange = { expanded = it },
            )
        }
    }
}
