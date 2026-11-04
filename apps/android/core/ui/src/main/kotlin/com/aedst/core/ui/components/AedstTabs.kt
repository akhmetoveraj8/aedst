package com.aedst.core.ui.components

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ScrollableTabRow
import androidx.compose.material3.Surface
import androidx.compose.material3.Tab
import androidx.compose.material3.TabRow
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.tooling.preview.Preview
import com.aedst.core.ui.theme.AedstTheme

/** Horizontal tab strip. Mirrors web's `tabs.tsx`. Set [scrollable] for many/long tab labels. */
@Composable
fun AedstTabs(
    tabs: List<String>,
    selectedIndex: Int,
    onTabSelected: (Int) -> Unit,
    modifier: Modifier = Modifier,
    scrollable: Boolean = false,
) {
    if (scrollable) {
        ScrollableTabRow(
            selectedTabIndex = selectedIndex,
            modifier = modifier,
            containerColor = MaterialTheme.colorScheme.background,
            contentColor = MaterialTheme.colorScheme.primary,
        ) {
            tabs.forEachIndexed { index, label ->
                Tab(
                    selected = index == selectedIndex,
                    onClick = { onTabSelected(index) },
                    text = { Text(label) },
                )
            }
        }
    } else {
        TabRow(
            selectedTabIndex = selectedIndex,
            modifier = modifier,
            containerColor = MaterialTheme.colorScheme.background,
            contentColor = MaterialTheme.colorScheme.primary,
        ) {
            tabs.forEachIndexed { index, label ->
                Tab(
                    selected = index == selectedIndex,
                    onClick = { onTabSelected(index) },
                    text = { Text(label) },
                )
            }
        }
    }
}

@Preview(name = "Light", showBackground = true)
@Preview(name = "Dark", uiMode = android.content.res.Configuration.UI_MODE_NIGHT_YES, showBackground = true)
@Composable
private fun AedstTabsPreview() {
    var selected by remember { mutableIntStateOf(0) }
    AedstTheme {
        Surface {
            AedstTabs(
                tabs = listOf("Overview", "Activity", "Settings"),
                selectedIndex = selected,
                onTabSelected = { selected = it },
            )
        }
    }
}
