package com.aedst.core.ui.components

import android.content.res.Configuration
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.Search
import androidx.compose.material3.BadgedBox
import androidx.compose.material3.Icon
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.unit.dp
import com.aedst.core.ui.theme.AedstSpacing
import com.aedst.core.ui.theme.AedstTheme

/**
 * One design-system component (or a small family, e.g. the card parts) rendered with representative state.
 *
 * Shared by the JVM screenshot tests (Roborazzi), the JVM semantics checks and the instrumented Accessibility Test
 * Framework suite (this directory is registered as an extra source dir of both `test` and `androidTest` in
 * core/ui/build.gradle.kts), so a component added to the catalog is covered by all three.
 *
 * @property id stable file/test-name slug.
 * @property group screenshot page the entry is rendered on (see [ComponentCatalog.groups]).
 * @property covers the public composable names this entry exercises (checked by `ComponentCatalogCoverageTest`).
 */
class CatalogEntry(val id: String, val group: String, val covers: Set<String>, val content: @Composable () -> Unit) {
    /** Used as the parameterized test name. */
    override fun toString(): String = id
}

private val sampleOptions = listOf("Owner", "Editor", "Viewer")

/** The catalog of every public design-system component that can be rendered inline in a window. */
object ComponentCatalog {

    /**
     * Public composables that are deliberately not in [entries], with the reason. Anything public that is in neither
     * place fails `ComponentCatalogCoverageTest`, so a new component cannot silently skip the checks.
     */
    val excluded: Map<String, String> = mapOf(
        "AedstAlertDialog" to "own window (Dialog); not part of the activity view hierarchy ATF/Roborazzi inspect",
        "AedstBottomSheet" to "own window (ModalBottomSheet)",
        "AedstBottomSheetContentPreview" to "public only so the IDE preview can reach it; renders sheet content",
        "AedstDatePickerDialog" to "own window (Dialog)",
        "AedstDialog" to "own window (Dialog)",
        "AedstDropdownMenu" to "popup window; the anchor/trigger is covered through AedstSelect",
        "AedstSnackbarHost" to "renders nothing until a message is queued; exercised by the feature screens",
        "AedstErrorSnackbarEffect" to "side effect only, renders nothing",
    )

    val entries: List<CatalogEntry> = actionEntries() + inputEntries() + selectionEntries() + feedbackEntries() +
        navigationEntries() + containerEntries()

    /** Screenshot pages, in a stable order: group id to its entries. */
    val groups: Map<String, List<CatalogEntry>> = entries.groupBy { it.group }

    /** Every composable name the catalog claims to cover. */
    val covered: Set<String> = entries.flatMapTo(mutableSetOf()) { it.covers }

    /**
     * [AedstTheme] plus a matching system night-mode flag: some components (e.g. [AedstAlert]) read
     * `isSystemInDarkTheme()` rather than the theme, so the flag must follow [dark] for instrumented dark runs.
     */
    @Composable
    fun Themed(dark: Boolean, content: @Composable () -> Unit) {
        val base = LocalConfiguration.current
        val configuration = remember(base, dark) {
            Configuration(base).apply {
                val night = if (dark) Configuration.UI_MODE_NIGHT_YES else Configuration.UI_MODE_NIGHT_NO
                uiMode = (uiMode and Configuration.UI_MODE_NIGHT_MASK.inv()) or night
            }
        }
        CompositionLocalProvider(LocalConfiguration provides configuration) {
            AedstTheme(useDarkTheme = dark) { Surface(content = content) }
        }
    }

    /** Renders a whole screenshot page: all entries of [group] stacked, the way a screen would. */
    @Composable
    fun Page(group: String) {
        Column(
            modifier = Modifier.padding(AedstSpacing.lg),
            verticalArrangement = Arrangement.spacedBy(AedstSpacing.md),
        ) {
            groups.getValue(group).forEach { it.content() }
        }
    }
}

private fun actionEntries(): List<CatalogEntry> = listOf(
    CatalogEntry("button_variants", "actions", setOf("AedstButton")) {
        Column(verticalArrangement = Arrangement.spacedBy(AedstSpacing.sm)) {
            AedstButtonVariant.entries.forEach { variant ->
                AedstButton(text = variant.name.lowercase(), onClick = {}, variant = variant)
            }
            AedstButton(text = "Loading", onClick = {}, loading = true)
            AedstButton(text = "Disabled", onClick = {}, enabled = false)
            AedstButton(text = "With icon", onClick = {}, leadingIcon = { Icon(Icons.Default.Check, null) })
        }
    },
    CatalogEntry("icon_button", "actions", setOf("AedstIconButton")) {
        Row(horizontalArrangement = Arrangement.spacedBy(AedstSpacing.sm)) {
            AedstIconButtonVariant.entries.forEach { variant ->
                AedstIconButton(
                    onClick = {},
                    contentDescription = "Search ${variant.name.lowercase()}",
                    variant = variant,
                    icon = { Icon(Icons.Default.Search, contentDescription = null) },
                )
            }
        }
    },
    CatalogEntry("fab", "actions", setOf("AedstFab")) {
        AedstFab(onClick = {}, contentDescription = "Add item") { Icon(Icons.Default.Check, contentDescription = null) }
    },
    CatalogEntry("filter_chip", "actions", setOf("AedstFilterChip")) {
        Row(horizontalArrangement = Arrangement.spacedBy(AedstSpacing.sm)) {
            AedstFilterChip(selected = true, onClick = {}, label = "High")
            AedstFilterChip(selected = false, onClick = {}, label = "Low")
        }
    },
)

private fun inputEntries(): List<CatalogEntry> = listOf(
    CatalogEntry("text_field", "inputs", setOf("AedstTextField", "AedstLabel")) {
        Column(verticalArrangement = Arrangement.spacedBy(AedstSpacing.sm)) {
            AedstLabel(text = "Email", required = true)
            AedstTextField(value = "ada@example.com", onValueChange = {}, label = "Email")
            AedstTextField(
                value = "not-an-email",
                onValueChange = {},
                label = "Email",
                isError = true,
                supportingText = "Enter a valid email address",
            )
            AedstTextField(value = "", onValueChange = {}, label = "Search", placeholder = "Type to search")
        }
    },
    CatalogEntry("text_area", "inputs", setOf("AedstTextArea")) {
        AedstTextArea(value = "Line one\nLine two", onValueChange = {}, label = "Notes")
    },
)

private fun selectionEntries(): List<CatalogEntry> = listOf(
    CatalogEntry("checkbox", "selection", setOf("AedstCheckbox")) {
        Column {
            AedstCheckbox(checked = true, onCheckedChange = {}, label = "Accept terms")
            AedstCheckbox(checked = false, onCheckedChange = {}, label = "Subscribe to updates")
            AedstCheckbox(checked = false, onCheckedChange = {}, label = "Disabled", enabled = false)
        }
    },
    CatalogEntry("switch", "selection", setOf("AedstSwitch")) {
        Column {
            AedstSwitch(checked = true, onCheckedChange = {}, label = "Notifications")
            AedstSwitch(checked = false, onCheckedChange = {}, label = "Dark mode")
        }
    },
    CatalogEntry("radio_group", "selection", setOf("AedstRadioGroup")) {
        AedstRadioGroup(
            options = sampleOptions,
            selected = "Editor",
            onSelectedChange = {},
            optionLabel = { it },
        )
    },
    CatalogEntry("select", "selection", setOf("AedstSelect")) {
        AedstSelect(
            options = sampleOptions,
            selected = "Owner",
            onSelectedChange = {},
            label = "Role",
            optionLabel = { it },
        )
    },
)

private fun feedbackEntries(): List<CatalogEntry> = listOf(
    CatalogEntry("count_badge", "feedback", setOf("AedstCountBadge")) {
        BadgedBox(badge = { AedstCountBadge("3") }) { Icon(Icons.Default.Search, contentDescription = null) }
    },
    CatalogEntry("alert", "feedback", setOf("AedstAlert")) {
        Column(verticalArrangement = Arrangement.spacedBy(AedstSpacing.sm)) {
            AedstAlertVariant.entries.forEach { variant ->
                AedstAlert(
                    title = variant.name.lowercase().replaceFirstChar(Char::uppercase),
                    description = "Something worth knowing about.",
                    variant = variant,
                )
            }
        }
    },
    CatalogEntry("badge", "feedback", setOf("AedstBadge")) {
        Row(horizontalArrangement = Arrangement.spacedBy(AedstSpacing.sm)) {
            AedstBadgeVariant.entries.forEach { variant ->
                AedstBadge(text = variant.name.lowercase(), variant = variant)
            }
        }
    },
    CatalogEntry("avatar", "feedback", setOf("AedstAvatar")) {
        Row(horizontalArrangement = Arrangement.spacedBy(AedstSpacing.sm)) {
            AedstAvatarSize.entries.forEach { AedstAvatar(initials = "ab", size = it) }
            AedstAvatar(initials = null)
        }
    },
    CatalogEntry("offline_banner", "feedback", setOf("AedstOfflineBanner")) {
        AedstOfflineBanner(isOffline = true)
    },
    CatalogEntry(
        "progress",
        "feedback",
        setOf("AedstLinearProgressIndicator", "AedstCircularProgressIndicator", "FullScreenLoading"),
    ) {
        Column(verticalArrangement = Arrangement.spacedBy(AedstSpacing.sm)) {
            AedstLinearProgressIndicator(progress = 0.6f)
            AedstLinearProgressIndicator(progress = null)
            Row(horizontalArrangement = Arrangement.spacedBy(AedstSpacing.md)) {
                AedstCircularProgressIndicator(progress = 0.6f)
                AedstCircularProgressIndicator(progress = null)
            }
            Box(Modifier.height(80.dp)) { FullScreenLoading() }
        }
    },
    CatalogEntry("skeleton", "feedback", setOf("AedstSkeleton", "AedstSkeletonText")) {
        Column(verticalArrangement = Arrangement.spacedBy(AedstSpacing.sm)) {
            AedstSkeleton(modifier = Modifier.height(48.dp).width(160.dp))
            AedstSkeletonText(lines = 3)
        }
    },
)

private fun navigationEntries(): List<CatalogEntry> = listOf(
    CatalogEntry("tabs", "navigation", setOf("AedstTabs")) {
        AedstTabs(tabs = listOf("Open", "Done", "All"), selectedIndex = 0, onTabSelected = {})
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

private fun containerEntries(): List<CatalogEntry> = listOf(
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
