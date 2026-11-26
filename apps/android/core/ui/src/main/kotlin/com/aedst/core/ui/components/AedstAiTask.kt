package com.aedst.core.ui.components

import android.content.res.Configuration
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.InsertDriveFile
import androidx.compose.material.icons.outlined.Search
import androidx.compose.material3.Icon
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
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.LayoutDirection
import androidx.compose.ui.unit.dp
import com.aedst.core.ui.theme.AedstShapesScale
import com.aedst.core.ui.theme.AedstSpacing
import com.aedst.core.ui.theme.AedstTheme

/**
 * One unit of agent work whose steps appear as the agent takes them, no pending steps (web `ai-task.tsx`). Several
 * tasks can be stacked; keep the running one open. Open by default.
 */
@Composable
@NonRestartableComposable
fun AedstAiTask(
    modifier: Modifier = Modifier,
    expanded: Boolean? = null,
    defaultExpanded: Boolean = true,
    onExpandedChange: ((Boolean) -> Unit)? = null,
    content: @Composable AedstAiDisclosureScope.() -> Unit,
) {
    AedstAiChainOfThought(modifier, expanded, defaultExpanded, onExpandedChange, content)
}

/** [title] in the present tense while running ("Searching..."), past tense when done ("Found 3 files"). */
@Composable
@NonRestartableComposable
fun AedstAiDisclosureScope.AedstAiTaskTrigger(
    title: String,
    modifier: Modifier = Modifier,
    status: AedstTraceStatus? = null,
    statusLabel: String? = null,
    description: String? = null,
    icon: ImageVector? = null,
) {
    AedstAiChainOfThoughtHeader(title, modifier, status, statusLabel, description, icon)
}

/** The steps panel: an [AedstAiChainOfThoughtContent] holding the [AedstAiTaskItem]s as a step list. */
@Composable
fun AedstAiDisclosureScope.AedstAiTaskContent(
    modifier: Modifier = Modifier,
    content: @Composable ColumnScope.() -> Unit,
) {
    AedstAiChainOfThoughtContent(modifier = modifier) { AedstAiChainOfThoughtSteps(content = content) }
}

/** One step the agent took: [status] running, error, or the default success when done. */
@Composable
@NonRestartableComposable
fun AedstAiTaskItem(
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

/** File chip under a step label (secondary colours, mono text, truncated); paths stay left to right in RTL. */
@Composable
fun AedstAiTaskItemFile(
    name: String,
    modifier: Modifier = Modifier,
    icon: ImageVector = Icons.AutoMirrored.Outlined.InsertDriveFile,
) {
    CompositionLocalProvider(LocalLayoutDirection provides LayoutDirection.Ltr) {
        Surface(
            modifier = modifier,
            shape = AedstShapesScale.medium,
            color = MaterialTheme.colorScheme.secondaryContainer,
            contentColor = MaterialTheme.colorScheme.onSecondaryContainer,
            border = BorderStroke(HAIRLINE, MaterialTheme.colorScheme.outlineVariant),
        ) {
            Row(
                modifier = Modifier.padding(horizontal = CHIP_PADDING, vertical = AedstSpacing.xxs),
                horizontalArrangement = Arrangement.spacedBy(AedstSpacing.xs),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Icon(imageVector = icon, contentDescription = null, modifier = Modifier.size(CHIP_ICON))
                Text(
                    text = name,
                    style = MaterialTheme.typography.labelSmall,
                    fontFamily = FontFamily.Monospace,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
            }
        }
    }
}

private val HAIRLINE = 1.dp // allow-dp: hairline border, web border
private val CHIP_PADDING = 6.dp // allow-dp: web px-1.5
private val CHIP_ICON = 12.dp // allow-dp: web size-3 icon

@Preview(name = "Light", showBackground = true)
@Preview(name = "Dark", uiMode = Configuration.UI_MODE_NIGHT_YES, showBackground = true)
@Composable
private fun AedstAiTaskPreview() {
    AedstTheme {
        Surface {
            AedstAiTask {
                AedstAiTaskTrigger(title = "Found 2 files", icon = Icons.Outlined.Search)
                AedstAiTaskContent {
                    AedstAiTaskItem(label = "Searched the repository")
                    AedstAiTaskItem(label = "Read") { AedstAiTaskItemFile("src/button.tsx") }
                    AedstAiTaskItem(label = "Reading the tests", status = AedstTraceStatus.RUNNING)
                }
            }
        }
    }
}
