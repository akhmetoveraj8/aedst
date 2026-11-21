package com.aedst.core.ui.components

import android.content.res.Configuration
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Home
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.tooling.preview.Preview
import com.aedst.core.ui.theme.AedstTheme

/** One destination of an [AedstNavigationMenu]. The [icon] is decorative: the label names the destination. */
class AedstNavigationMenuItem(val id: String, val label: String, val icon: @Composable () -> Unit)

/**
 * Top-level destinations, mirroring web's `navigation-menu.tsx` (a horizontal site menu there). On a phone that
 * role belongs to the Material 3 bottom [NavigationBar], which this wraps with the kit's colours; it handles window
 * insets, selection semantics and 48dp+ targets. Screens that must switch between bar, rail and drawer by window
 * size use the adaptive navigation suite in the app module instead.
 */
@Composable
fun AedstNavigationMenu(
    items: List<AedstNavigationMenuItem>,
    selectedId: String?,
    onItemSelected: (AedstNavigationMenuItem) -> Unit,
    modifier: Modifier = Modifier,
) {
    NavigationBar(
        modifier = modifier,
        containerColor = MaterialTheme.colorScheme.surface,
        contentColor = MaterialTheme.colorScheme.onSurface,
    ) {
        items.forEach { item ->
            NavigationBarItem(
                selected = item.id == selectedId,
                onClick = { onItemSelected(item) },
                icon = item.icon,
                label = { Text(item.label) },
            )
        }
    }
}

@Preview(name = "Light", showBackground = true)
@Preview(name = "Dark", uiMode = Configuration.UI_MODE_NIGHT_YES, showBackground = true)
@Composable
private fun AedstNavigationMenuPreview() {
    AedstTheme {
        Surface {
            AedstNavigationMenu(
                items = listOf(
                    AedstNavigationMenuItem("home", "Home") { Icon(Icons.Default.Home, contentDescription = null) },
                    AedstNavigationMenuItem("settings", "Settings") {
                        Icon(Icons.Default.Settings, contentDescription = null)
                    },
                ),
                selectedId = "home",
                onItemSelected = {},
            )
        }
    }
}
