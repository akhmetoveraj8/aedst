package com.aedst.core.ui.components

import android.content.res.Configuration
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.ElevatedCard
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.Dp
import com.aedst.core.ui.theme.AedstElevation
import com.aedst.core.ui.theme.AedstShapesScale
import com.aedst.core.ui.theme.AedstSpacing
import com.aedst.core.ui.theme.AedstTheme

/**
 * Layout surface mirroring web's `Card`/`CardHeader`/`CardTitle`/`CardDescription`/`CardContent`/
 * `CardFooter` composition API. Compose the slot children below inside [content] in the same
 * order web does.
 */
@Composable
fun AedstCard(
    modifier: Modifier = Modifier,
    elevation: Dp = AedstElevation.level1,
    content: @Composable ColumnScope.() -> Unit,
) {
    val shape = AedstShapesScale.extraLarge
    if (elevation <= AedstElevation.none) {
        Card(
            modifier = modifier,
            shape = shape,
            colors = CardDefaults.cardColors(
                containerColor = MaterialTheme.colorScheme.surface,
                contentColor = MaterialTheme.colorScheme.onSurface,
            ),
            content = content,
        )
    } else {
        ElevatedCard(
            modifier = modifier,
            shape = shape,
            colors = CardDefaults.elevatedCardColors(
                containerColor = MaterialTheme.colorScheme.surface,
                contentColor = MaterialTheme.colorScheme.onSurface,
            ),
            elevation = CardDefaults.elevatedCardElevation(defaultElevation = elevation),
            content = content,
        )
    }
}

/** Top slot of [AedstCard]: stacks [AedstCardTitle] and [AedstCardDescription]. */
@Composable
fun AedstCardHeader(modifier: Modifier = Modifier, content: @Composable ColumnScope.() -> Unit) {
    Column(
        modifier = modifier
            .fillMaxWidth()
            .padding(horizontal = AedstSpacing.lg, vertical = AedstSpacing.md),
        verticalArrangement = Arrangement.spacedBy(AedstSpacing.xs),
        content = content,
    )
}

@Composable
fun AedstCardTitle(text: String, modifier: Modifier = Modifier) {
    Text(text = text, modifier = modifier, style = MaterialTheme.typography.titleMedium)
}

@Composable
fun AedstCardDescription(text: String, modifier: Modifier = Modifier) {
    Text(
        text = text,
        modifier = modifier,
        style = MaterialTheme.typography.bodySmall,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
    )
}

/** Main body slot of [AedstCard]. */
@Composable
fun AedstCardContent(modifier: Modifier = Modifier, content: @Composable ColumnScope.() -> Unit) {
    Column(
        modifier = modifier
            .fillMaxWidth()
            .padding(horizontal = AedstSpacing.lg, vertical = AedstSpacing.md),
        content = content,
    )
}

/** Bottom slot of [AedstCard], typically holding action buttons. */
@Composable
fun AedstCardFooter(modifier: Modifier = Modifier, content: @Composable RowScope.() -> Unit) {
    Row(
        modifier = modifier
            .fillMaxWidth()
            .padding(horizontal = AedstSpacing.lg, vertical = AedstSpacing.md),
        horizontalArrangement = Arrangement.spacedBy(AedstSpacing.sm),
        verticalAlignment = Alignment.CenterVertically,
        content = content,
    )
}

@Preview(name = "Light", showBackground = true)
@Preview(name = "Dark", uiMode = Configuration.UI_MODE_NIGHT_YES, showBackground = true)
@Composable
private fun AedstCardPreview() {
    AedstTheme {
        Surface {
            AedstCard(modifier = Modifier.padding(AedstSpacing.lg)) {
                AedstCardHeader {
                    AedstCardTitle(text = "Project Alpha")
                    AedstCardDescription(text = "Status and recent activity")
                }
                AedstCardContent {
                    Text("Everything is on track for this sprint.")
                }
                AedstCardFooter {
                    Text("Updated 2h ago")
                }
            }
        }
    }
}
