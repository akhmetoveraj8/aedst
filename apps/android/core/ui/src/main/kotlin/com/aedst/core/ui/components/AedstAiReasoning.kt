package com.aedst.core.ui.components

import android.content.res.Configuration
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Psychology
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.NonRestartableComposable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.tooling.preview.Preview
import com.aedst.core.ui.theme.AedstTheme

/**
 * Model reasoning as one collapsible line (web `ai-reasoning.tsx`). It opens while the model thinks
 * ([isStreaming]) and closes when it finishes, unless the user opened or closed it ([defaultExpanded] seeds that
 * choice); [expanded] makes it controlled and wins over both.
 */
@Composable
@NonRestartableComposable
fun AedstAiReasoning(
    modifier: Modifier = Modifier,
    isStreaming: Boolean = false,
    expanded: Boolean? = null,
    defaultExpanded: Boolean? = null,
    onExpandedChange: ((Boolean) -> Unit)? = null,
    content: @Composable AedstAiDisclosureScope.() -> Unit,
) {
    AiDisclosureLine(expanded, defaultExpanded, isStreaming, onExpandedChange, modifier, isStreaming, content)
}

/**
 * Title line: [thinkingLabel] ("Thinking") with a spinner while streaming, [thoughtLabel] ("Thought for 5 s", the
 * caller formats the duration) once finished. The line is a polite live region, so the switch is announced.
 */
@Composable
fun AedstAiDisclosureScope.AedstAiReasoningTrigger(
    thinkingLabel: String,
    thoughtLabel: String,
    modifier: Modifier = Modifier,
    icon: ImageVector = Icons.Outlined.Psychology,
    description: String? = null,
) {
    AedstAiChainOfThoughtHeader(
        title = if (isStreaming) thinkingLabel else thoughtLabel,
        modifier = modifier.semantics { liveRegion = LiveRegionMode.Polite },
        status = if (isStreaming) AedstTraceStatus.RUNNING else null,
        description = description,
        icon = icon,
    )
}

/** The reasoning [text]; line breaks are kept. Markdown rendering is the caller's (pass plain text here). */
@Composable
fun AedstAiDisclosureScope.AedstAiReasoningContent(text: String, modifier: Modifier = Modifier) {
    AedstAiChainOfThoughtContent(modifier = modifier) {
        Text(
            text = text,
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }
}

@Preview(name = "Light", showBackground = true)
@Preview(name = "Dark", uiMode = Configuration.UI_MODE_NIGHT_YES, showBackground = true)
@Composable
private fun AedstAiReasoningPreview() {
    AedstTheme {
        Surface {
            AedstAiReasoning(isStreaming = true) {
                AedstAiReasoningTrigger(thinkingLabel = "Thinking", thoughtLabel = "Thought for 5 s")
                AedstAiReasoningContent("The user asks for a summary.\nFirst I look at the release notes.")
            }
        }
    }
}
