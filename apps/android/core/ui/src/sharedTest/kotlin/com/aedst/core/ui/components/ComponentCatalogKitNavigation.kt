package com.aedst.core.ui.components

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.size
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.Search
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.aedst.core.ui.theme.AedstSpacing

/** Navigation and disclosure components. */
internal fun kitNavigationEntries(): List<CatalogEntry> = listOf(
    CatalogEntry("breadcrumb", "kit_navigation", setOf("AedstBreadcrumb")) {
        AedstBreadcrumb(
            items = listOf(
                AedstBreadcrumbItem("Home", onClick = {}),
                AedstBreadcrumbItem("Projects", onClick = {}),
                AedstBreadcrumbItem("Release plan"),
            ),
        )
    },
    CatalogEntry("accordion", "kit_navigation", setOf("AedstAccordion", "AedstCollapsible")) {
        Column {
            AedstAccordion(
                items = listOf(
                    AedstAccordionItem("shipping", "Shipping") { Text("Ships in two days.") },
                    AedstAccordionItem("returns", "Returns") { Text("Free returns for 30 days.") },
                ),
                expandedIds = setOf("shipping"),
                onExpandedChange = {},
            )
            AedstCollapsible(title = "Advanced options", expanded = false, onExpandedChange = {}) {
                Text("Hidden")
            }
        }
    },
    CatalogEntry("menubar", "kit_navigation", setOf("AedstMenubar")) {
        AedstMenubar(
            menus = listOf(
                AedstMenubarMenu("File", listOf(AedstDropdownMenuOption("new", "New"))),
                AedstMenubarMenu("Edit", listOf(AedstDropdownMenuOption("undo", "Undo"))),
            ),
            onOptionSelected = {},
        )
    },
    CatalogEntry("navigation_menu", "kit_navigation", setOf("AedstNavigationMenu")) {
        AedstNavigationMenu(
            items = listOf(
                AedstNavigationMenuItem("home", "Home") { Icon(Icons.Default.Check, contentDescription = null) },
                AedstNavigationMenuItem("search", "Search") { Icon(Icons.Default.Search, contentDescription = null) },
            ),
            selectedId = "home",
            onItemSelected = {},
        )
    },
    CatalogEntry("sidebar", "kit_navigation", setOf("AedstSidebar", "AedstSidebarMenuButton")) {
        Box(Modifier.height(200.dp)) {
            AedstSidebar(header = { Text("AEDST") }, footer = { Text("v1.0") }) {
                AedstSidebarMenuButton(label = "Home", onClick = {}, selected = true)
                AedstSidebarMenuButton(
                    label = "Settings",
                    onClick = {},
                    variant = AedstSidebarMenuButtonVariant.OUTLINE,
                    size = AedstSidebarMenuButtonSize.LG,
                )
            }
        }
    },
    CatalogEntry("command", "kit_navigation", setOf("AedstCommand")) {
        AedstCommand(
            groups = listOf(
                AedstCommandGroup("Tasks", listOf(AedstCommandItem("new", "New task", shortcut = "N"))),
                AedstCommandGroup("Account", listOf(AedstCommandItem("out", "Sign out"))),
            ),
            onItemSelected = {},
            searchLabel = "Search commands",
            emptyText = "No results",
        )
    },
)

/** Anchored overlays (rendered closed: the popup itself is its own window) and the resizable panes. */
internal fun kitOverlayEntries(): List<CatalogEntry> = listOf(
    CatalogEntry("overlay_anchors", "kit_overlay", setOf("AedstTooltip", "AedstHoverCard", "AedstPopover")) {
        Row(horizontalArrangement = Arrangement.spacedBy(AedstSpacing.sm)) {
            AedstTooltip(text = "Search") {
                AedstIconButton(onClick = {}, contentDescription = "Search") {
                    Icon(Icons.Default.Search, contentDescription = null)
                }
            }
            AedstHoverCard(card = { Text("Owner of three projects.") }, title = "Ada") { Text("@ada") }
            AedstPopover(
                expanded = false,
                onDismissRequest = {},
                trigger = { AedstButton(text = "Open", onClick = {}) },
            ) {
                Text("Popover")
            }
        }
    },
    CatalogEntry("context_menu", "kit_overlay", setOf("AedstContextMenu")) {
        AedstContextMenu(
            options = listOf(
                AedstContextMenuItem(value = "rename", label = "Rename"),
                AedstContextMenuItem("delete", "Delete", variant = AedstContextMenuItemVariant.DESTRUCTIVE),
            ),
            onOptionSelected = {},
        ) {
            Text("Touch and hold")
        }
    },
    CatalogEntry("resizable", "kit_overlay", setOf("AedstResizable")) {
        AedstResizable(
            fraction = 0.4f,
            onFractionChange = {},
            first = { Text("List") },
            second = { Text("Detail") },
            modifier = Modifier.size(width = 320.dp, height = 96.dp),
        )
    },
)
