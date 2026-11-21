package com.aedst.core.ui.components

import android.content.res.Configuration
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.KeyboardArrowDown
import androidx.compose.material.icons.filled.KeyboardArrowUp
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import com.aedst.core.ui.R
import com.aedst.core.ui.theme.AedstSpacing
import com.aedst.core.ui.theme.AedstTheme

/** One column of an [AedstDataTable] over a row type [T]. A [sortable] column's header is a button. */
class AedstDataTableColumn<T>(val header: String, val sortable: Boolean = false, val cell: (T) -> String)

/** Current sort of an [AedstDataTable]: the column index and the direction. */
data class AedstDataTableSort(val column: Int, val ascending: Boolean)

/**
 * Table over typed rows with sortable column headers, mirroring web's `data-table.tsx`. Sorting is hoisted: a
 * header press reports the next [AedstDataTableSort] (ascending, then descending) and the caller passes the rows
 * already sorted (the server or the ViewModel owns the order). [emptyText] is shown when [rows] is empty. Pair it
 * with [AedstPagination] for paged data.
 */
@Composable
fun <T> AedstDataTable(
    columns: List<AedstDataTableColumn<T>>,
    rows: List<T>,
    emptyText: String,
    modifier: Modifier = Modifier,
    sort: AedstDataTableSort? = null,
    onSortChange: (AedstDataTableSort) -> Unit = {},
) {
    Column(modifier = modifier.fillMaxWidth()) {
        Row(modifier = Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            columns.forEachIndexed { index, column ->
                val ascending = sort?.takeIf { it.column == index }?.ascending
                HeaderCell(
                    header = column.header,
                    sortable = column.sortable,
                    ascending = ascending,
                    onClick = { onSortChange(AedstDataTableSort(index, ascending != true)) },
                )
            }
        }
        rows.forEach { row ->
            AedstDivider()
            Row(modifier = Modifier.fillMaxWidth()) {
                columns.forEach { column ->
                    Text(
                        text = column.cell(row),
                        style = MaterialTheme.typography.bodyMedium,
                        modifier = Modifier.weight(1f).padding(AedstSpacing.sm),
                    )
                }
            }
        }
        if (rows.isEmpty()) {
            AedstDivider()
            Text(
                text = emptyText,
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.padding(AedstSpacing.lg).align(Alignment.CenterHorizontally),
            )
        }
    }
}

/** [ascending] is null when the table is not sorted by this column. */
@Composable
private fun RowScope.HeaderCell(header: String, sortable: Boolean, ascending: Boolean?, onClick: () -> Unit) {
    val state = stringResource(
        when (ascending) {
            true -> R.string.aedst_a11y_sort_ascending
            false -> R.string.aedst_a11y_sort_descending
            null -> R.string.aedst_a11y_sort_none
        },
    )
    val click = if (sortable) {
        Modifier
            .clickable(role = Role.Button, onClick = onClick)
            .semantics { stateDescription = state }
    } else {
        Modifier
    }
    Row(
        modifier = Modifier
            .weight(1f)
            .then(click)
            .heightIn(min = 48.dp)
            .padding(horizontal = AedstSpacing.sm)
            .semantics { heading() },
        horizontalArrangement = Arrangement.spacedBy(AedstSpacing.xs),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(
            text = header,
            style = MaterialTheme.typography.labelLarge,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.weight(1f, fill = false),
        )
        if (ascending != null) {
            Icon(
                imageVector = if (ascending) Icons.Default.KeyboardArrowUp else Icons.Default.KeyboardArrowDown,
                contentDescription = null,
                modifier = Modifier.size(16.dp),
            )
        }
    }
}

@Preview(name = "Light", showBackground = true)
@Preview(name = "Dark", uiMode = Configuration.UI_MODE_NIGHT_YES, showBackground = true)
@Composable
private fun AedstDataTablePreview() {
    var sort by remember { mutableStateOf(AedstDataTableSort(column = 0, ascending = true)) }
    val rows = listOf("Ada" to "Owner", "Grace" to "Editor")
    AedstTheme {
        Surface {
            AedstDataTable(
                columns = listOf(
                    AedstDataTableColumn<Pair<String, String>>("Name", sortable = true) { it.first },
                    AedstDataTableColumn("Role") { it.second },
                ),
                rows = if (sort.ascending) rows else rows.reversed(),
                emptyText = "No members",
                sort = sort,
                onSortChange = { sort = it },
                modifier = Modifier.padding(AedstSpacing.lg),
            )
        }
    }
}
