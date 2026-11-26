package com.aedst.core.ui.components

import android.content.res.Configuration
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.SmartToy
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.NonRestartableComposable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalLayoutDirection
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.LayoutDirection
import androidx.compose.ui.unit.dp
import com.aedst.core.ui.theme.AedstSpacing
import com.aedst.core.ui.theme.AedstTheme

/** A delegated agent run: its task, model and tools, then its own tool calls (web `ai-subagent.tsx`). */
@Composable
@NonRestartableComposable
fun AedstAiSubagent(
    modifier: Modifier = Modifier,
    expanded: Boolean? = null,
    defaultExpanded: Boolean = false,
    onExpandedChange: ((Boolean) -> Unit)? = null,
    content: @Composable AedstAiDisclosureScope.() -> Unit,
) {
    AedstAiChainOfThought(modifier, expanded, defaultExpanded, onExpandedChange, content)
}

/**
 * [title]: "Running the research agent" while it works, "Ran the research agent" when done. [status] is running while
 * the subagent works and error on failure; [description] holds the duration.
 */
@Composable
fun AedstAiDisclosureScope.AedstAiSubagentTrigger(
    title: String,
    modifier: Modifier = Modifier,
    status: AedstTraceStatus? = null,
    statusLabel: String? = null,
    description: String? = null,
    icon: ImageVector = Icons.Outlined.SmartToy,
) {
    AedstAiChainOfThoughtHeader(title, modifier, status, statusLabel, description, icon)
}

/** The panel; nested tool calls keep their open state while it is collapsed. */
@Composable
@NonRestartableComposable
fun AedstAiDisclosureScope.AedstAiSubagentContent(
    modifier: Modifier = Modifier,
    content: @Composable ColumnScope.() -> Unit,
) {
    AedstAiChainOfThoughtContent(modifier = modifier, content = content)
}

/** The instruction the parent agent gave. */
@Composable
fun AedstAiSubagentTask(text: String, modifier: Modifier = Modifier) {
    Text(
        text = text,
        style = MaterialTheme.typography.bodyMedium,
        color = MaterialTheme.colorScheme.onSurface,
        modifier = modifier.padding(horizontal = AedstSpacing.sm),
    )
}

/** Model and tools as labelled badge rows (web: a description list). */
@Composable
fun AedstAiSubagentMeta(modifier: Modifier = Modifier, content: @Composable ColumnScope.() -> Unit) {
    Column(
        modifier = modifier.fillMaxWidth().padding(horizontal = AedstSpacing.sm),
        verticalArrangement = Arrangement.spacedBy(META_GAP),
        content = content,
    )
}

/** [label] ("Model") and the [model] id as an outline badge, kept left to right. */
@Composable
fun AedstAiSubagentModel(label: String, model: String, modifier: Modifier = Modifier) {
    MetaRow(label, modifier) { LtrBadge(model, AedstBadgeVariant.OUTLINE) }
}

/** [label] ("Tools") and one secondary badge per tool name, kept left to right. */
@Composable
fun AedstAiSubagentTools(label: String, tools: List<String>, modifier: Modifier = Modifier) {
    MetaRow(label, modifier) { tools.forEach { LtrBadge(it, AedstBadgeVariant.SECONDARY) } }
}

@Composable
@NonRestartableComposable
fun AedstAiSubagentSteps(modifier: Modifier = Modifier, content: @Composable ColumnScope.() -> Unit) {
    AedstAiChainOfThoughtSteps(modifier = modifier, content = content)
}

/** One tool call the subagent made. */
@Composable
@NonRestartableComposable
fun AedstAiSubagentStep(
    label: String,
    modifier: Modifier = Modifier,
    description: String? = null,
    status: AedstTraceStatus = AedstTraceStatus.SUCCESS,
    icon: ImageVector? = null,
    statusLabel: String? = null,
    content: (@Composable ColumnScope.() -> Unit)? = null,
) {
    AedstAiChainOfThoughtStep(label, modifier, description, status, icon, statusLabel, content)
}

/** One term and its badges, read as one node ("Model, gpt-5"). */
@Composable
private fun MetaRow(label: String, modifier: Modifier = Modifier, values: @Composable () -> Unit) {
    Row(
        modifier = modifier.fillMaxWidth().semantics(mergeDescendants = true) {},
        horizontalArrangement = Arrangement.spacedBy(AedstSpacing.md),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(
            text = label,
            style = MaterialTheme.typography.labelSmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        FlowRow(
            modifier = Modifier.weight(1f),
            horizontalArrangement = Arrangement.spacedBy(AedstSpacing.xs),
            verticalArrangement = Arrangement.spacedBy(AedstSpacing.xs),
        ) { values() }
    }
}

@Composable
private fun LtrBadge(text: String, variant: AedstBadgeVariant) {
    CompositionLocalProvider(LocalLayoutDirection provides LayoutDirection.Ltr) {
        AedstBadge(text = text, variant = variant)
    }
}

private val META_GAP = 6.dp // allow-dp: web gap-y-1.5

@Preview(name = "Light", showBackground = true)
@Preview(name = "Dark", uiMode = Configuration.UI_MODE_NIGHT_YES, showBackground = true)
@Composable
private fun AedstAiSubagentPreview() {
    AedstTheme {
        Surface {
            AedstAiSubagent(defaultExpanded = true) {
                AedstAiSubagentTrigger(
                    title = "Running the research agent",
                    status = AedstTraceStatus.RUNNING,
                    description = "12 s",
                )
                AedstAiSubagentContent {
                    AedstAiSubagentTask("Find the three most cited papers on retrieval.")
                    AedstAiSubagentMeta {
                        AedstAiSubagentModel(label = "Model", model = "research-1")
                        AedstAiSubagentTools(label = "Tools", tools = listOf("web_search", "read_url"))
                    }
                    AedstAiSubagentSteps {
                        AedstAiSubagentStep(label = "Searched the web")
                        AedstAiSubagentStep(label = "Reading a paper", status = AedstTraceStatus.RUNNING)
                    }
                }
            }
        }
    }
}
