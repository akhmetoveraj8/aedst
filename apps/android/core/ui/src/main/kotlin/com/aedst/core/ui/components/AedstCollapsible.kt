package com.aedst.core.ui.components

import android.content.res.Configuration
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.KeyboardArrowDown
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
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import com.aedst.core.ui.R
import com.aedst.core.ui.theme.AedstSpacing
import com.aedst.core.ui.theme.AedstTheme

/**
 * A titled disclosure: a full-width trigger row that shows or hides [content], mirroring web's `collapsible.tsx`.
 * State is hoisted ([expanded], [onExpandedChange]). The trigger is a button whose state description says
 * "Expanded" / "Collapsed"; the row is at least 48dp tall.
 */
@Composable
fun AedstCollapsible(
    title: String,
    expanded: Boolean,
    onExpandedChange: (Boolean) -> Unit,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
    content: @Composable ColumnScope.() -> Unit,
) {
    val state = stringResource(if (expanded) R.string.aedst_a11y_expanded else R.string.aedst_a11y_collapsed)
    Column(modifier = modifier.fillMaxWidth()) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .clickable(enabled = enabled, role = Role.Button) { onExpandedChange(!expanded) }
                .semantics { stateDescription = state }
                .heightIn(min = 48.dp)
                .padding(horizontal = AedstSpacing.sm),
            horizontalArrangement = Arrangement.spacedBy(AedstSpacing.sm),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(text = title, style = MaterialTheme.typography.titleSmall, modifier = Modifier.weight(1f))
            Icon(
                imageVector = Icons.Default.KeyboardArrowDown,
                contentDescription = null,
                tint = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.rotate(if (expanded) 180f else 0f),
            )
        }
        AnimatedVisibility(visible = expanded) {
            Column(
                modifier = Modifier.padding(horizontal = AedstSpacing.sm, vertical = AedstSpacing.xs),
                content = content,
            )
        }
    }
}

@Preview(name = "Light", showBackground = true)
@Preview(name = "Dark", uiMode = Configuration.UI_MODE_NIGHT_YES, showBackground = true)
@Composable
private fun AedstCollapsiblePreview() {
    var expanded by remember { mutableStateOf(true) }
    AedstTheme {
        Surface {
            AedstCollapsible(title = "Advanced options", expanded = expanded, onExpandedChange = { expanded = it }) {
                Text("Hidden until the row is expanded.")
            }
        }
    }
}
