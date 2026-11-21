package com.aedst.core.ui.components

import android.content.res.Configuration
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowRight
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.paneTitle
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import com.aedst.core.ui.R
import com.aedst.core.ui.theme.AedstSpacing
import com.aedst.core.ui.theme.AedstTheme

/** One level of an [AedstBreadcrumb]. The last item is the current page and is never clickable. */
class AedstBreadcrumbItem(val label: String, val onClick: (() -> Unit)? = null)

/**
 * Path of ancestor pages ending in the current one, mirroring web's `breadcrumb.tsx`. Scrolls horizontally when the
 * path is longer than the window; the separator chevron mirrors in RTL.
 */
@Composable
fun AedstBreadcrumb(items: List<AedstBreadcrumbItem>, modifier: Modifier = Modifier) {
    val title = stringResource(R.string.aedst_a11y_breadcrumb)
    Row(
        modifier = modifier
            .semantics { paneTitle = title }
            .horizontalScroll(rememberScrollState()),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        items.forEachIndexed { index, item ->
            val isCurrent = index == items.lastIndex
            if (index > 0) {
                Icon(
                    imageVector = Icons.AutoMirrored.Filled.KeyboardArrowRight,
                    contentDescription = null,
                    tint = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.size(16.dp),
                )
            }
            val onClick = item.onClick.takeUnless { isCurrent }
            val click = if (onClick != null) Modifier.clickable(role = Role.Button, onClick = onClick) else Modifier
            Box(
                modifier = click
                    .semantics { if (isCurrent) selected = true }
                    .heightIn(min = 48.dp)
                    .widthIn(min = if (onClick != null) 48.dp else 0.dp)
                    .padding(horizontal = AedstSpacing.xs),
                contentAlignment = Alignment.Center,
            ) {
                Text(
                    text = item.label,
                    style = MaterialTheme.typography.bodyMedium,
                    color = if (isCurrent) {
                        MaterialTheme.colorScheme.onSurface
                    } else {
                        MaterialTheme.colorScheme.onSurfaceVariant
                    },
                )
            }
        }
    }
}

@Preview(name = "Light", showBackground = true)
@Preview(name = "Dark", uiMode = Configuration.UI_MODE_NIGHT_YES, showBackground = true)
@Composable
private fun AedstBreadcrumbPreview() {
    AedstTheme {
        Surface {
            AedstBreadcrumb(
                items = listOf(
                    AedstBreadcrumbItem("Home", onClick = {}),
                    AedstBreadcrumbItem("Projects", onClick = {}),
                    AedstBreadcrumbItem("Release plan"),
                ),
            )
        }
    }
}
