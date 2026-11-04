package com.aedst.core.ui.components

import android.content.res.Configuration
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material3.FloatingActionButton
import androidx.compose.material3.Icon
import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.tooling.preview.Preview
import com.aedst.core.ui.theme.AedstTheme

/**
 * Floating action button. Feature code uses this instead of Material3's `FloatingActionButton` (enforced by the
 * `ForbiddenImport/Material3Raw` detekt gate). [contentDescription] is applied on the button so the accessible name
 * always matches the action; [icon] is the glyph slot (pass an `Icon(..., contentDescription = null)`).
 */
@Composable
fun AedstFab(
    onClick: () -> Unit,
    contentDescription: String,
    modifier: Modifier = Modifier,
    icon: @Composable () -> Unit,
) {
    FloatingActionButton(
        onClick = onClick,
        modifier = modifier.semantics { this.contentDescription = contentDescription },
        content = icon,
    )
}

@Preview(name = "Light", showBackground = true)
@Preview(name = "Dark", uiMode = Configuration.UI_MODE_NIGHT_YES, showBackground = true)
@Composable
private fun AedstFabPreview() {
    AedstTheme {
        Surface {
            AedstFab(onClick = {}, contentDescription = "Add item") {
                Icon(imageVector = Icons.Default.Add, contentDescription = null)
            }
        }
    }
}
