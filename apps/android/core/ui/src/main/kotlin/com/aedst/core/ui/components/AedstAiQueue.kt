package com.aedst.core.ui.components

import android.content.res.Configuration
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Checklist
import androidx.compose.material.icons.outlined.Delete
import androidx.compose.material3.Icon
import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.runtime.NonRestartableComposable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.tooling.preview.Preview
import com.aedst.core.ui.components.support.AiStepRow
import com.aedst.core.ui.theme.AedstSpacing
import com.aedst.core.ui.theme.AedstTheme

/** Todo state (the agent's `writeTodos` vocabulary); [status] is its line status. */
enum class AedstAiQueueItemStatus(val status: AedstTraceStatus) {
    PENDING(AedstTraceStatus.PENDING),
    IN_PROGRESS(AedstTraceStatus.RUNNING),
    COMPLETED(AedstTraceStatus.SUCCESS),
}

/** The agent's todo list, grouped in [AedstAiQueueSection]s such as "To do" and "Completed" (web `ai-queue.tsx`). */
@Composable
fun AedstAiQueue(modifier: Modifier = Modifier, content: @Composable ColumnScope.() -> Unit) {
    Column(
        modifier = modifier.fillMaxWidth(),
        verticalArrangement = Arrangement.spacedBy(AedstSpacing.xs),
        content = content,
    )
}

/** A collapsible group of todos; open by default. */
@Composable
@NonRestartableComposable
fun AedstAiQueueSection(
    modifier: Modifier = Modifier,
    expanded: Boolean? = null,
    defaultExpanded: Boolean = true,
    onExpandedChange: ((Boolean) -> Unit)? = null,
    content: @Composable AedstAiDisclosureScope.() -> Unit,
) {
    AedstAiChainOfThought(modifier, expanded, defaultExpanded, onExpandedChange, content)
}

/** The section line; [label] is pluralised by the caller ("2 to do", "Completed"). */
@Composable
fun AedstAiDisclosureScope.AedstAiQueueSectionTrigger(
    label: String,
    modifier: Modifier = Modifier,
    status: AedstTraceStatus? = null,
    statusLabel: String? = null,
    description: String? = null,
    icon: ImageVector = Icons.Outlined.Checklist,
) {
    AedstAiChainOfThoughtHeader(label, modifier, status, statusLabel, description, icon)
}

@Composable
@NonRestartableComposable
fun AedstAiDisclosureScope.AedstAiQueueSectionContent(
    modifier: Modifier = Modifier,
    content: @Composable ColumnScope.() -> Unit,
) {
    AedstAiChainOfThoughtContent(modifier = modifier, content = content)
}

@Composable
@NonRestartableComposable
fun AedstAiQueueList(modifier: Modifier = Modifier, content: @Composable ColumnScope.() -> Unit) {
    AedstAiChainOfThoughtSteps(modifier = modifier, content = content)
}

/**
 * One todo: an icon per [status], completed ones muted and struck through. Put [AedstAiQueueItemActions] in
 * [content]; on touch screens the actions are always visible (web reveals them on hover only for fine pointers).
 */
@Composable
fun AedstAiQueueItem(
    label: String,
    modifier: Modifier = Modifier,
    status: AedstAiQueueItemStatus = AedstAiQueueItemStatus.PENDING,
    description: String? = null,
    icon: ImageVector? = null,
    statusLabel: String? = null,
    content: (@Composable ColumnScope.() -> Unit)? = null,
) {
    AiStepRow(
        label = label,
        modifier = modifier,
        description = description,
        status = status.status,
        icon = icon,
        statusLabel = statusLabel,
        isStruck = status == AedstAiQueueItemStatus.COMPLETED,
        content = content,
    )
}

/** Buttons for one todo. */
@Composable
fun AedstAiQueueItemActions(modifier: Modifier = Modifier, content: @Composable RowScope.() -> Unit) {
    Row(
        modifier = modifier,
        horizontalArrangement = Arrangement.spacedBy(AedstSpacing.xs),
        verticalAlignment = Alignment.CenterVertically,
        content = content,
    )
}

/** An icon-only ghost button (48dp target); [label] is its accessible name. */
@Composable
fun AedstAiQueueItemAction(label: String, icon: ImageVector, onClick: () -> Unit, modifier: Modifier = Modifier) {
    AedstIconButton(
        onClick = onClick,
        contentDescription = label,
        modifier = modifier,
        variant = AedstIconButtonVariant.GHOST,
    ) {
        Icon(imageVector = icon, contentDescription = null)
    }
}

@Preview(name = "Light", showBackground = true)
@Preview(name = "Dark", uiMode = Configuration.UI_MODE_NIGHT_YES, showBackground = true)
@Composable
private fun AedstAiQueuePreview() {
    AedstTheme {
        Surface {
            AedstAiQueue {
                AedstAiQueueSection {
                    AedstAiQueueSectionTrigger(label = "2 to do")
                    AedstAiQueueSectionContent {
                        AedstAiQueueList {
                            AedstAiQueueItem(label = "Write the tests", status = AedstAiQueueItemStatus.IN_PROGRESS)
                            AedstAiQueueItem(label = "Update the docs") {
                                AedstAiQueueItemActions {
                                    AedstAiQueueItemAction(label = "Remove", icon = Icons.Outlined.Delete, onClick = {})
                                }
                            }
                        }
                    }
                }
                AedstAiQueueSection(defaultExpanded = false) {
                    AedstAiQueueSectionTrigger(label = "Completed")
                    AedstAiQueueSectionContent {
                        AedstAiQueueItem(label = "Read the issue", status = AedstAiQueueItemStatus.COMPLETED)
                    }
                }
            }
        }
    }
}
