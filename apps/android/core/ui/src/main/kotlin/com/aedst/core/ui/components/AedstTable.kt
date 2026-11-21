package com.aedst.core.ui.components

import android.content.res.Configuration
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.CollectionInfo
import androidx.compose.ui.semantics.CollectionItemInfo
import androidx.compose.ui.semantics.collectionInfo
import androidx.compose.ui.semantics.collectionItemInfo
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.tooling.preview.Preview
import com.aedst.core.ui.theme.AedstSpacing
import com.aedst.core.ui.theme.AedstTheme

/**
 * Static text table, mirroring web's `table.tsx`: a header row, body rows separated by hairlines and an optional
 * [caption] under it. Columns share the width equally and cells wrap, so it stays readable at 200 % font scale; for
 * sorting use [AedstDataTable]. Cell positions are exposed to accessibility services (row / column of each cell).
 */
@Composable
fun AedstTable(
    headers: List<String>,
    rows: List<List<String>>,
    modifier: Modifier = Modifier,
    caption: String? = null,
) {
    Column(
        modifier = modifier
            .fillMaxWidth()
            .semantics { collectionInfo = CollectionInfo(rowCount = rows.size + 1, columnCount = headers.size) },
    ) {
        Row(modifier = Modifier.fillMaxWidth()) {
            headers.forEachIndexed { column, header ->
                Text(
                    text = header,
                    style = MaterialTheme.typography.labelLarge,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier
                        .weight(1f)
                        .padding(AedstSpacing.sm)
                        .semantics {
                            heading()
                            collectionItemInfo = CollectionItemInfo(0, 1, column, 1)
                        },
                )
            }
        }
        rows.forEachIndexed { rowIndex, cells ->
            AedstDivider()
            Row(modifier = Modifier.fillMaxWidth()) {
                cells.forEachIndexed { column, cell ->
                    Text(
                        text = cell,
                        style = MaterialTheme.typography.bodyMedium,
                        modifier = Modifier
                            .weight(1f)
                            .padding(AedstSpacing.sm)
                            .semantics { collectionItemInfo = CollectionItemInfo(rowIndex + 1, 1, column, 1) },
                    )
                }
            }
        }
        if (caption != null) {
            Text(
                text = caption,
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.padding(AedstSpacing.sm),
            )
        }
    }
}

@Preview(name = "Light", showBackground = true)
@Preview(name = "Dark", uiMode = Configuration.UI_MODE_NIGHT_YES, showBackground = true)
@Composable
private fun AedstTablePreview() {
    AedstTheme {
        Surface {
            AedstTable(
                headers = listOf("Invoice", "Status", "Amount"),
                rows = listOf(listOf("INV-001", "Paid", "250"), listOf("INV-002", "Pending", "150")),
                caption = "Recent invoices",
                modifier = Modifier.padding(AedstSpacing.lg),
            )
        }
    }
}
