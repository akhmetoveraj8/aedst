package com.aedst.core.ui.components

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.height
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Check
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.aedst.core.ui.theme.AedstSpacing

/** Catalog entries of the navigation and container components (split from ComponentCatalog.kt for file size). */
internal fun navigationEntries(): List<CatalogEntry> = listOf(
    CatalogEntry("tabs", "navigation", setOf("AedstTabs")) {
        Column(verticalArrangement = Arrangement.spacedBy(AedstSpacing.sm)) {
            AedstTabsVariant.entries.forEach { variant ->
                AedstTabs(
                    tabs = listOf("Open", "Done", "All"),
                    selectedIndex = 0,
                    onTabSelected = {},
                    variant = variant,
                )
            }
        }
    },
    CatalogEntry("top_app_bar", "navigation", setOf("AedstTopAppBar")) {
        AedstTopAppBar(
            title = "Tasks",
            navigationIcon = {
                AedstIconButton(
                    onClick = {},
                    contentDescription = "Back",
                    icon = { Icon(Icons.Default.Check, contentDescription = null) },
                )
            },
        )
    },
)

internal fun containerEntries(): List<CatalogEntry> = listOf(
    CatalogEntry(
        "card",
        "containers",
        setOf(
            "AedstCard",
            "AedstCardHeader",
            "AedstCardTitle",
            "AedstCardDescription",
            "AedstCardContent",
            "AedstCardFooter",
        ),
    ) {
        AedstCard {
            AedstCardHeader {
                AedstCardTitle("Release plan")
                AedstCardDescription("Ship the beta on Friday")
            }
            AedstCardContent { Text("Three tasks are still open.") }
            AedstCardFooter { AedstButton(text = "Open", onClick = {}) }
        }
    },
    CatalogEntry("divider", "containers", setOf("AedstDivider")) {
        Column {
            AedstDivider()
            Row(Modifier.height(24.dp)) { AedstDivider(orientation = AedstDividerOrientation.VERTICAL) }
        }
    },
)
