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
import androidx.compose.runtime.Stable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.Dp
import com.aedst.core.ui.theme.AedstElevation
import com.aedst.core.ui.theme.AedstShapesScale
import com.aedst.core.ui.theme.AedstSpacing
import com.aedst.core.ui.theme.AedstTheme

/** Inner spacing and title size of an [AedstCard], mirroring web's `card.tsx` `size`. */
enum class AedstCardSize {
    /** 16dp padding and gaps, the regular title. */
    DEFAULT,

    /** 12dp padding and gaps, a smaller title: dense lists and sidebars. */
    SM,
}

/**
 * Receiver of an [AedstCard]'s content (and of its header's): a [ColumnScope] that also carries the card's [size], so
 * the slots ([AedstCardHeader], [AedstCardTitle], [AedstCardContent], [AedstCardFooter]) get it explicitly through
 * the receiver instead of a CompositionLocal.
 */
@Stable
sealed class AedstCardScope : ColumnScope {
    /** The [AedstCard] `size` the slots pad and type themselves by. */
    abstract val size: AedstCardSize
}

private class AedstCardScopeImpl(column: ColumnScope, override val size: AedstCardSize) :
    AedstCardScope(),
    ColumnScope by column

private val AedstCardSize.spacing: Dp
    get() = if (this == AedstCardSize.SM) AedstSpacing.md else AedstSpacing.lg

private val AedstCardSize.verticalSpacing: Dp
    get() = if (this == AedstCardSize.SM) AedstSpacing.sm else AedstSpacing.md

/**
 * Layout surface mirroring web's `Card`/`CardHeader`/`CardTitle`/`CardDescription`/`CardContent`/
 * `CardFooter` composition API. Compose the slot children below inside [content] (an [AedstCardScope]) in the same
 * order web does. [size] sets the padding of every slot and the title size (web `size`).
 */
@Composable
fun AedstCard(
    modifier: Modifier = Modifier,
    elevation: Dp = AedstElevation.level1,
    size: AedstCardSize = AedstCardSize.DEFAULT,
    content: @Composable AedstCardScope.() -> Unit,
) {
    AedstCardSurface(elevation = elevation, modifier = modifier) {
        val scope = remember(this, size) { AedstCardScopeImpl(this, size) }
        scope.content()
    }
}

@Composable
private fun AedstCardSurface(
    elevation: Dp,
    modifier: Modifier = Modifier,
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
fun AedstCardScope.AedstCardHeader(modifier: Modifier = Modifier, content: @Composable AedstCardScope.() -> Unit) {
    // Read here: inside the Column the card scope is hidden by the nearer layout scope (DSL marker).
    val cardSize = size
    Column(
        modifier = modifier
            .fillMaxWidth()
            .padding(horizontal = cardSize.spacing, vertical = cardSize.verticalSpacing),
        verticalArrangement = Arrangement.spacedBy(AedstSpacing.xs),
    ) {
        val scope = remember(this, cardSize) { AedstCardScopeImpl(this, cardSize) }
        scope.content()
    }
}

@Composable
fun AedstCardScope.AedstCardTitle(text: String, modifier: Modifier = Modifier) {
    val style = if (size == AedstCardSize.SM) {
        MaterialTheme.typography.labelLarge
    } else {
        MaterialTheme.typography.titleMedium
    }
    Text(text = text, modifier = modifier, style = style)
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
fun AedstCardScope.AedstCardContent(modifier: Modifier = Modifier, content: @Composable ColumnScope.() -> Unit) {
    Column(
        modifier = modifier
            .fillMaxWidth()
            .padding(horizontal = size.spacing, vertical = size.verticalSpacing),
        content = content,
    )
}

/** Bottom slot of [AedstCard], typically holding action buttons. */
@Composable
fun AedstCardScope.AedstCardFooter(modifier: Modifier = Modifier, content: @Composable RowScope.() -> Unit) {
    Row(
        modifier = modifier
            .fillMaxWidth()
            .padding(horizontal = size.spacing, vertical = size.verticalSpacing),
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
