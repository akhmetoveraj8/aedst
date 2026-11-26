package com.aedst.core.ui.components

import android.content.res.Configuration
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Route
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.NonRestartableComposable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.tooling.preview.Preview
import com.aedst.core.ui.theme.AedstSpacing
import com.aedst.core.ui.theme.AedstTheme

/**
 * Every step of the agent's plan, known up front, pending ones included (web `ai-plan.tsx`). Use [AedstAiTask] when
 * the steps appear as the agent takes them. Open by default; [isStreaming] puts a spinner on the title line.
 */
@Composable
@NonRestartableComposable
fun AedstAiPlan(
    modifier: Modifier = Modifier,
    isStreaming: Boolean = false,
    expanded: Boolean? = null,
    defaultExpanded: Boolean = true,
    onExpandedChange: ((Boolean) -> Unit)? = null,
    content: @Composable AedstAiDisclosureScope.() -> Unit,
) {
    AiDisclosureLine(expanded, defaultExpanded, defaultExpanded, onExpandedChange, modifier, isStreaming, content)
}

/**
 * Row holding the [AedstAiPlanTrigger] and, beside it (never inside it), an [AedstAiPlanAction]. Give the trigger
 * `Modifier.weight(1f)` so the actions keep their width.
 */
@Composable
fun AedstAiPlanHeader(modifier: Modifier = Modifier, content: @Composable RowScope.() -> Unit) {
    Row(
        modifier = modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(AedstSpacing.xs),
        verticalAlignment = Alignment.CenterVertically,
        content = content,
    )
}

/** The plan title line; [description] carries progress such as "2 of 5 done". */
@Composable
fun AedstAiDisclosureScope.AedstAiPlanTrigger(
    title: String,
    modifier: Modifier = Modifier,
    description: String? = null,
    statusLabel: String? = null,
    icon: ImageVector = Icons.Outlined.Route,
) {
    AedstAiChainOfThoughtHeader(
        title = title,
        modifier = modifier,
        status = if (isStreaming) AedstTraceStatus.RUNNING else null,
        statusLabel = statusLabel,
        description = description,
        icon = icon,
    )
}

/** Buttons next to the trigger (edit, run). */
@Composable
fun AedstAiPlanAction(modifier: Modifier = Modifier, content: @Composable RowScope.() -> Unit) {
    Row(
        modifier = modifier,
        horizontalArrangement = Arrangement.spacedBy(AedstSpacing.xs),
        verticalAlignment = Alignment.CenterVertically,
        content = content,
    )
}

@Composable
@NonRestartableComposable
fun AedstAiDisclosureScope.AedstAiPlanContent(
    modifier: Modifier = Modifier,
    content: @Composable ColumnScope.() -> Unit,
) {
    AedstAiChainOfThoughtContent(modifier = modifier, content = content)
}

/** Summary above the steps. */
@Composable
fun AedstAiPlanDescription(text: String, modifier: Modifier = Modifier) {
    Text(
        text = text,
        style = MaterialTheme.typography.bodyMedium,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
        modifier = modifier.padding(horizontal = AedstSpacing.sm),
    )
}

@Composable
@NonRestartableComposable
fun AedstAiPlanSteps(modifier: Modifier = Modifier, content: @Composable ColumnScope.() -> Unit) {
    AedstAiChainOfThoughtSteps(modifier = modifier, content = content)
}

/** One step: [status] pending, running (current), success (done), error or skipped. */
@Composable
@NonRestartableComposable
fun AedstAiPlanStep(
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

@Composable
fun AedstAiPlanFooter(modifier: Modifier = Modifier, content: @Composable RowScope.() -> Unit) {
    Row(
        modifier = modifier
            .fillMaxWidth()
            .padding(start = AedstSpacing.sm, end = AedstSpacing.sm, top = AedstSpacing.xs),
        horizontalArrangement = Arrangement.spacedBy(AedstSpacing.sm),
        verticalAlignment = Alignment.CenterVertically,
        content = content,
    )
}

@Preview(name = "Light", showBackground = true)
@Preview(name = "Dark", uiMode = Configuration.UI_MODE_NIGHT_YES, showBackground = true)
@Composable
private fun AedstAiPlanPreview() {
    AedstTheme {
        Surface {
            AedstAiPlan(isStreaming = true) {
                AedstAiPlanHeader {
                    AedstAiPlanTrigger(title = "Plan", description = "1 of 3 done", modifier = Modifier.weight(1f))
                    AedstAiPlanAction {
                        AedstButton(
                            text = "Edit",
                            onClick = {},
                            variant = AedstButtonVariant.GHOST,
                            size = AedstButtonSize.SM,
                        )
                    }
                }
                AedstAiPlanContent {
                    AedstAiPlanDescription("Rename the button and update its tests.")
                    AedstAiPlanSteps {
                        AedstAiPlanStep(label = "Find every usage")
                        AedstAiPlanStep(label = "Rename the component", status = AedstTraceStatus.RUNNING)
                        AedstAiPlanStep(label = "Run the tests", status = AedstTraceStatus.PENDING)
                    }
                    AedstAiPlanFooter {
                        AedstButton(text = "Run plan", onClick = {}, size = AedstButtonSize.SM)
                    }
                }
            }
        }
    }
}
