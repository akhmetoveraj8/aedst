package com.aedst.core.ui.components

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.Search
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.aedst.core.ui.theme.AedstSpacing

private const val SAMPLE_CODE = "fun main() {\n    println(1)\n}"

private val sampleSteps = listOf(
    AedstTraceStep("plan", "Plan", AedstTraceStatus.SUCCESS, duration = "0.4 s"),
    AedstTraceStep(
        id = "search",
        title = "Search",
        status = AedstTraceStatus.RUNNING,
        detail = "query: release notes",
        children = listOf(
            AedstTraceStep("fetch", "Fetch page", AedstTraceStatus.PENDING),
            AedstTraceStep("parse", "Parse page", AedstTraceStatus.ERROR),
        ),
    ),
    AedstTraceStep("write", "Write answer", AedstTraceStatus.SKIPPED),
)

/** Text, status and content-display components of the shadcn parity set. */
internal fun kitDisplayEntries(): List<CatalogEntry> = listOf(
    CatalogEntry("typography", "kit_display", setOf("AedstTypography")) {
        Column(verticalArrangement = Arrangement.spacedBy(AedstSpacing.xs)) {
            AedstTypographyVariant.entries.forEach { variant ->
                AedstTypography(
                    text = if (variant == AedstTypographyVariant.LIST) "First\nSecond" else variant.name,
                    variant = variant,
                )
            }
        }
    },
    CatalogEntry("kbd_spinner", "kit_display", setOf("AedstKbd", "AedstSpinner")) {
        Row(horizontalArrangement = Arrangement.spacedBy(AedstSpacing.sm)) {
            AedstKbd("Ctrl")
            AedstKbd("K")
            AedstSpinner()
        }
    },
    CatalogEntry("empty", "kit_display", setOf("AedstEmpty")) {
        AedstEmpty(
            title = "No tasks yet",
            description = "Create the first task to get started.",
            variant = AedstEmptyVariant.ICON,
            media = { Icon(Icons.Default.Search, contentDescription = null) },
            actions = { AedstButton(text = "New task", onClick = {}) },
        )
    },
    CatalogEntry("item", "kit_display", setOf("AedstItem")) {
        Column(verticalArrangement = Arrangement.spacedBy(AedstSpacing.xs)) {
            AedstItemVariant.entries.forEach { variant ->
                AedstItem(
                    title = "Ada Lovelace",
                    description = "ada@example.com",
                    variant = variant,
                    mediaVariant = AedstItemMediaVariant.ICON,
                    onClick = {},
                    media = { Icon(Icons.Default.Check, contentDescription = null) },
                    actions = { AedstBadge(text = "Owner") },
                )
            }
            AedstItem(title = "Extra small", size = AedstItemSize.XS)
        }
    },
    CatalogEntry("code_block", "kit_display", setOf("AedstCodeBlock")) {
        AedstCodeBlock(code = SAMPLE_CODE, filename = "Main.kt", showLineNumbers = true, onCopy = {})
    },
)

/** Tables, charts, traces and paging. */
internal fun kitDataEntries(): List<CatalogEntry> = listOf(
    CatalogEntry("table", "kit_data", setOf("AedstTable")) {
        AedstTable(
            headers = listOf("Invoice", "Status"),
            rows = listOf(listOf("INV-001", "Paid"), listOf("INV-002", "Pending")),
            caption = "Recent invoices",
        )
    },
    CatalogEntry("data_table", "kit_data", setOf("AedstDataTable")) {
        AedstDataTable(
            columns = listOf(
                AedstDataTableColumn<Pair<String, String>>("Name", sortable = true) { it.first },
                AedstDataTableColumn("Role") { it.second },
            ),
            rows = listOf("Ada" to "Owner", "Grace" to "Editor"),
            emptyText = "No members",
            sort = AedstDataTableSort(column = 0, ascending = true),
        )
    },
    CatalogEntry("pagination", "kit_data", setOf("AedstPagination")) {
        AedstPagination(currentPage = 5, pageCount = 12, onPageChange = {})
    },
    CatalogEntry("chart", "kit_data", setOf("AedstChart")) {
        AedstChart(
            series = listOf(
                AedstChartSeries("Created", listOf(4f, 7f, 5f, 9f)),
                AedstChartSeries("Done", listOf(2f, 6f, 5f, 7f)),
            ),
            contentDescription = "Tasks per week: created 25, done 20",
        )
    },
    CatalogEntry("trace", "kit_data", setOf("AedstTrace")) {
        AedstTrace(steps = sampleSteps, statusLabel = { it.name.lowercase() })
    },
    CatalogEntry("carousel", "kit_data", setOf("AedstCarousel")) {
        AedstCarousel(pageCount = 3) { index ->
            Box(Modifier.fillMaxWidth().height(64.dp)) { Text("Slide ${index + 1}") }
        }
    },
)

/** Form layout and input components. */
internal fun kitFormEntries(): List<CatalogEntry> = listOf(
    CatalogEntry("form_field", "kit_forms", setOf("AedstForm", "AedstField")) {
        AedstForm {
            AedstField(label = "Email", description = "Used for sign-in.", error = "Enter a valid email") {
                AedstTextField(value = "ada@", onValueChange = {}, label = "Email", isError = true)
            }
            AedstField(label = "Notifications", orientation = AedstFieldOrientation.HORIZONTAL) {
                AedstSwitch(checked = true, onCheckedChange = {}, label = "On")
            }
        }
    },
    CatalogEntry("input_group", "kit_forms", setOf("AedstInputGroup", "AedstInputGroupButton")) {
        Column(verticalArrangement = Arrangement.spacedBy(AedstSpacing.sm)) {
            AedstInputGroup(value = "", onValueChange = {}, label = "Search", placeholder = "Search") {
                Icon(Icons.Default.Search, contentDescription = null)
            }
            AedstInputGroup(
                value = "aedst.example",
                onValueChange = {},
                label = "Website",
                align = AedstInputGroupAlign.BLOCK_END,
            ) {
                AedstInputGroupButton(text = "Copy", onClick = {})
            }
        }
    },
    CatalogEntry("input_otp", "kit_forms", setOf("AedstInputOtp")) {
        AedstInputOtp(value = "123", onValueChange = {}, label = "Verification code")
    },
    CatalogEntry("slider", "kit_forms", setOf("AedstSlider")) {
        AedstSlider(value = 0.4f, onValueChange = {}, contentDescription = "Volume")
    },
    CatalogEntry("toggle", "kit_forms", setOf("AedstToggle", "AedstToggleGroup", "AedstButtonGroup")) {
        Column(verticalArrangement = Arrangement.spacedBy(AedstSpacing.sm)) {
            Row(horizontalArrangement = Arrangement.spacedBy(AedstSpacing.sm)) {
                AedstToggleSize.entries.forEach { size ->
                    AedstToggle(pressed = size == AedstToggleSize.DEFAULT, onPressedChange = {}, size = size) {
                        Text(size.name.lowercase())
                    }
                }
            }
            AedstToggleGroup(
                options = listOf("Day", "Week", "Month"),
                selected = setOf("Week"),
                onSelectedChange = {},
                optionLabel = { it },
            )
            AedstButtonGroup {
                AedstButton(text = "Left", onClick = {}, variant = AedstButtonVariant.OUTLINE)
                AedstButton(text = "Right", onClick = {}, variant = AedstButtonVariant.OUTLINE)
            }
        }
    },
    CatalogEntry("combobox", "kit_forms", setOf("AedstCombobox", "AedstNativeSelect")) {
        Column(verticalArrangement = Arrangement.spacedBy(AedstSpacing.sm)) {
            AedstCombobox(
                options = listOf("Dushanbe", "Tashkent"),
                selected = "Tashkent",
                onSelectedChange = {},
                optionLabel = { it },
                emptyText = "No city found",
                label = "City",
            )
            AedstNativeSelect(
                options = listOf("English", "Tajik"),
                selected = "Tajik",
                onSelectedChange = {},
                optionLabel = { it },
                label = "Language",
                placeholder = "Choose a language",
            )
        }
    },
    CatalogEntry("calendar", "kit_forms", setOf("AedstCalendar")) {
        // 2026-01-15T00:00:00Z: a fixed date keeps the screenshot stable.
        AedstCalendar(selectedDateMillis = 1_768_435_200_000L, onDateSelected = {})
    },
)
