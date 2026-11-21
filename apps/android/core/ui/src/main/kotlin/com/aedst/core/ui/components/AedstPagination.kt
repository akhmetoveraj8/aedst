package com.aedst.core.ui.components

import android.content.res.Configuration
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowLeft
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowRight
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.paneTitle
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import com.aedst.core.ui.R
import com.aedst.core.ui.theme.AedstShapesScale
import com.aedst.core.ui.theme.AedstSpacing
import com.aedst.core.ui.theme.AedstTheme

/**
 * Pages to show for [current] of [total] (both 1-based): the first, the last, the current one with [siblings]
 * neighbours on each side, and `null` where pages are skipped (drawn as an ellipsis).
 */
internal fun paginationPages(current: Int, total: Int, siblings: Int = 1): List<Int?> {
    if (total <= 0) return emptyList()
    val shown = (1..total).filter { it == 1 || it == total || it in (current - siblings)..(current + siblings) }
    return buildList {
        shown.forEachIndexed { index, page ->
            if (index > 0 && page - shown[index - 1] > 1) add(null)
            add(page)
        }
    }
}

/**
 * Page navigation: previous, page numbers with ellipses, next; mirroring web's `pagination.tsx`. [currentPage] is
 * 1-based and hoisted. Page buttons are named "Page n" and the current one is announced as selected; the chevrons
 * mirror in RTL and the row scrolls horizontally at large font scales.
 */
@Composable
fun AedstPagination(currentPage: Int, pageCount: Int, onPageChange: (Int) -> Unit, modifier: Modifier = Modifier) {
    val title = stringResource(R.string.aedst_a11y_pagination)
    val morePages = stringResource(R.string.aedst_a11y_more_pages)
    Row(
        modifier = modifier
            .semantics { paneTitle = title }
            .horizontalScroll(rememberScrollState()),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        AedstIconButton(
            onClick = { onPageChange(currentPage - 1) },
            contentDescription = stringResource(R.string.aedst_a11y_previous),
            enabled = currentPage > 1,
        ) {
            Icon(Icons.AutoMirrored.Filled.KeyboardArrowLeft, contentDescription = null)
        }
        paginationPages(currentPage, pageCount).forEach { page ->
            if (page == null) {
                Text(
                    text = ELLIPSIS,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier
                        .padding(horizontal = AedstSpacing.xs)
                        .semantics { contentDescription = morePages },
                )
            } else {
                PageButton(page = page, selected = page == currentPage, onClick = { onPageChange(page) })
            }
        }
        AedstIconButton(
            onClick = { onPageChange(currentPage + 1) },
            contentDescription = stringResource(R.string.aedst_a11y_next),
            enabled = currentPage < pageCount,
        ) {
            Icon(Icons.AutoMirrored.Filled.KeyboardArrowRight, contentDescription = null)
        }
    }
}

@Composable
private fun PageButton(page: Int, selected: Boolean, onClick: () -> Unit) {
    val description = stringResource(R.string.aedst_a11y_page, page)
    Surface(
        selected = selected,
        onClick = onClick,
        modifier = Modifier.semantics {
            role = Role.Button
            contentDescription = description
        },
        shape = AedstShapesScale.medium,
        color = if (selected) MaterialTheme.colorScheme.surfaceVariant else Color.Transparent,
        contentColor = MaterialTheme.colorScheme.onSurface,
    ) {
        Box(modifier = Modifier.size(40.dp), contentAlignment = Alignment.Center) {
            Text(text = page.toString(), style = MaterialTheme.typography.labelLarge)
        }
    }
}

private const val ELLIPSIS = "…"

@Preview(name = "Light", showBackground = true)
@Preview(name = "Dark", uiMode = Configuration.UI_MODE_NIGHT_YES, showBackground = true)
@Composable
private fun AedstPaginationPreview() {
    var page by remember { mutableIntStateOf(5) }
    AedstTheme {
        Surface { AedstPagination(currentPage = page, pageCount = 12, onPageChange = { page = it }) }
    }
}
