package com.aedst.core.ui.components

import androidx.compose.foundation.layout.RowScope
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material3.CenterAlignedTopAppBar
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.tooling.preview.Preview
import com.aedst.core.ui.theme.AedstTheme

/**
 * App bar, mirroring web's page header pattern. Wraps Material3's [TopAppBar] /
 * [CenterAlignedTopAppBar], themed with the surface color pair.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun AedstTopAppBar(
    title: String,
    modifier: Modifier = Modifier,
    navigationIcon: (@Composable () -> Unit)? = null,
    actions: @Composable RowScope.() -> Unit = {},
    centered: Boolean = false,
) {
    val colors = TopAppBarDefaults.topAppBarColors(
        containerColor = MaterialTheme.colorScheme.surface,
        titleContentColor = MaterialTheme.colorScheme.onSurface,
        navigationIconContentColor = MaterialTheme.colorScheme.onSurface,
        actionIconContentColor = MaterialTheme.colorScheme.onSurface,
    )
    if (centered) {
        CenterAlignedTopAppBar(
            title = { Text(title) },
            modifier = modifier,
            navigationIcon = navigationIcon ?: {},
            actions = actions,
            colors = colors,
        )
    } else {
        TopAppBar(
            title = { Text(title) },
            modifier = modifier,
            navigationIcon = navigationIcon ?: {},
            actions = actions,
            colors = colors,
        )
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Preview(name = "Light", showBackground = true)
@Preview(name = "Dark", showBackground = true, uiMode = android.content.res.Configuration.UI_MODE_NIGHT_YES)
@Composable
private fun AedstTopAppBarPreview() {
    AedstTheme {
        AedstTopAppBar(
            title = "Tasks",
            navigationIcon = {
                IconButton(onClick = {}) {
                    Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Back")
                }
            },
            centered = true,
        )
    }
}
