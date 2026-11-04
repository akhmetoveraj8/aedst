package com.aedst.core.ui.components

import android.content.res.Configuration
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Notifications
import androidx.compose.material3.Badge
import androidx.compose.material3.BadgedBox
import androidx.compose.material3.Icon
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.tooling.preview.Preview
import com.aedst.core.ui.theme.AedstTheme

/**
 * The small count bubble that sits on a [androidx.compose.material3.BadgedBox] icon (tab-bar unread count). Not the
 * same as [AedstBadge], which is a stand-alone status pill. Feature code uses this instead of Material3's `Badge`
 * (enforced by the `ForbiddenImport/Material3Raw` detekt gate).
 */
@Composable
fun AedstCountBadge(text: String, modifier: Modifier = Modifier) {
    Badge(modifier = modifier) { Text(text) }
}

@Preview(name = "Light", showBackground = true)
@Preview(name = "Dark", uiMode = Configuration.UI_MODE_NIGHT_YES, showBackground = true)
@Composable
private fun AedstCountBadgePreview() {
    AedstTheme {
        Surface {
            BadgedBox(badge = { AedstCountBadge("3") }) {
                Icon(Icons.Filled.Notifications, contentDescription = null)
            }
        }
    }
}
