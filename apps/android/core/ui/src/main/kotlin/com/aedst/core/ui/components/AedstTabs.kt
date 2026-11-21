package com.aedst.core.ui.components

import android.content.res.Configuration
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.selection.selectableGroup
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.PrimaryScrollableTabRow
import androidx.compose.material3.PrimaryTabRow
import androidx.compose.material3.Surface
import androidx.compose.material3.Tab
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.tooling.preview.Preview
import com.aedst.core.ui.theme.AedstShapesScale
import com.aedst.core.ui.theme.AedstSpacing
import com.aedst.core.ui.theme.AedstTheme

/** Visual treatment of [AedstTabs], mirroring web's `tabs.tsx` list `variant` (ui-kit.yaml: default, line). */
enum class AedstTabsVariant {
    /** Segmented control: a muted track with a raised selected tab. */
    DEFAULT,

    /** Underlined tabs (the Material 3 primary tab row). */
    LINE,
}

/** Horizontal tab strip. Mirrors web's `tabs.tsx`. Set [scrollable] for many/long tab labels. */
@Composable
fun AedstTabs(
    tabs: List<String>,
    selectedIndex: Int,
    onTabSelected: (Int) -> Unit,
    modifier: Modifier = Modifier,
    variant: AedstTabsVariant = AedstTabsVariant.DEFAULT,
    scrollable: Boolean = false,
) {
    when (variant) {
        AedstTabsVariant.DEFAULT -> SegmentedTabs(tabs, selectedIndex, onTabSelected, scrollable, modifier)
        AedstTabsVariant.LINE -> LineTabs(tabs, selectedIndex, onTabSelected, scrollable, modifier)
    }
}

@Composable
private fun SegmentedTabs(
    tabs: List<String>,
    selectedIndex: Int,
    onTabSelected: (Int) -> Unit,
    scrollable: Boolean,
    modifier: Modifier = Modifier,
) {
    Surface(modifier = modifier, shape = AedstShapesScale.large, color = MaterialTheme.colorScheme.surfaceVariant) {
        val scroll = if (scrollable) Modifier.horizontalScroll(rememberScrollState()) else Modifier
        Row(
            modifier = Modifier.selectableGroup().then(scroll).padding(AedstSpacing.xxs),
            horizontalArrangement = Arrangement.spacedBy(AedstSpacing.xxs),
        ) {
            tabs.forEachIndexed { index, label ->
                val selected = index == selectedIndex
                Surface(
                    selected = selected,
                    onClick = { onTabSelected(index) },
                    modifier = (if (scrollable) Modifier else Modifier.weight(1f)).semantics { role = Role.Tab },
                    shape = AedstShapesScale.medium,
                    color = if (selected) MaterialTheme.colorScheme.background else Color.Transparent,
                    contentColor = if (selected) {
                        MaterialTheme.colorScheme.onBackground
                    } else {
                        MaterialTheme.colorScheme.onSurfaceVariant
                    },
                ) {
                    Box(contentAlignment = Alignment.Center) {
                        Text(
                            text = label,
                            style = MaterialTheme.typography.labelLarge,
                            modifier = Modifier.padding(horizontal = AedstSpacing.md, vertical = AedstSpacing.sm),
                        )
                    }
                }
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun LineTabs(
    tabs: List<String>,
    selectedIndex: Int,
    onTabSelected: (Int) -> Unit,
    scrollable: Boolean,
    modifier: Modifier = Modifier,
) {
    val content: @Composable () -> Unit = {
        tabs.forEachIndexed { index, label ->
            Tab(selected = index == selectedIndex, onClick = { onTabSelected(index) }, text = { Text(label) })
        }
    }
    if (scrollable) {
        PrimaryScrollableTabRow(
            selectedTabIndex = selectedIndex,
            modifier = modifier,
            containerColor = MaterialTheme.colorScheme.background,
            contentColor = MaterialTheme.colorScheme.primary,
            tabs = content,
        )
    } else {
        PrimaryTabRow(
            selectedTabIndex = selectedIndex,
            modifier = modifier,
            containerColor = MaterialTheme.colorScheme.background,
            contentColor = MaterialTheme.colorScheme.primary,
            tabs = content,
        )
    }
}

@Preview(name = "Light", showBackground = true)
@Preview(name = "Dark", uiMode = Configuration.UI_MODE_NIGHT_YES, showBackground = true)
@Composable
private fun AedstTabsPreview() {
    var selected by remember { mutableIntStateOf(0) }
    AedstTheme {
        Surface {
            Column(verticalArrangement = Arrangement.spacedBy(AedstSpacing.md)) {
                AedstTabsVariant.entries.forEach { variant ->
                    AedstTabs(
                        tabs = listOf("Overview", "Activity", "Settings"),
                        selectedIndex = selected,
                        onTabSelected = { selected = it },
                        variant = variant,
                    )
                }
            }
        }
    }
}
