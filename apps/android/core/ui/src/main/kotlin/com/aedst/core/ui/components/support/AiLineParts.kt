package com.aedst.core.ui.components.support

import androidx.compose.foundation.ScrollState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.unit.dp
import com.aedst.core.ui.components.AedstCodeBlock
import com.aedst.core.ui.components.AedstTraceStatus
import com.aedst.core.ui.components.TraceStatusIcon
import com.aedst.core.ui.theme.AedstSpacing

/**
 * Leading icon of an AI line (web `StatusIcon`): running and failed lines always show the status icon (spinner,
 * cross); otherwise a caller [icon] wins over the status icon. Decorative: the status is said in words elsewhere.
 */
@Composable
internal fun AiStatusIcon(status: AedstTraceStatus?, icon: ImageVector?) {
    val isForced = status == AedstTraceStatus.RUNNING || status == AedstTraceStatus.ERROR
    if (icon != null && !isForced) {
        Icon(
            imageVector = icon,
            contentDescription = null,
            tint = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.size(AI_LINE_ICON_SIZE),
        )
    } else {
        TraceStatusIcon(status ?: AedstTraceStatus.SUCCESS)
    }
}

/**
 * One step line (web `AiChainOfThoughtStep`): status icon, label, optional description, then [content]. The label and
 * description are read as one node whose state description is [statusLabel]. [isStruck] draws a completed todo.
 */
@Composable
internal fun AiStepRow(
    label: String,
    modifier: Modifier = Modifier,
    description: String? = null,
    status: AedstTraceStatus = AedstTraceStatus.SUCCESS,
    icon: ImageVector? = null,
    statusLabel: String? = null,
    isStruck: Boolean = false,
    content: (@Composable ColumnScope.() -> Unit)? = null,
) {
    val colors = MaterialTheme.colorScheme
    val isQuiet = isStruck || status == AedstTraceStatus.PENDING || status == AedstTraceStatus.SKIPPED
    Row(
        modifier = modifier.fillMaxWidth().padding(horizontal = AedstSpacing.sm, vertical = STEP_PADDING),
        horizontalArrangement = Arrangement.spacedBy(AedstSpacing.sm),
    ) {
        Box(modifier = Modifier.height(LINE_HEIGHT), contentAlignment = Alignment.Center) { AiStatusIcon(status, icon) }
        Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(AedstSpacing.xs)) {
            Column(
                modifier = Modifier.semantics(mergeDescendants = true) {
                    if (statusLabel != null) stateDescription = statusLabel
                },
            ) {
                Text(
                    text = label,
                    style = MaterialTheme.typography.bodyMedium,
                    color = if (isQuiet) colors.onSurfaceVariant else colors.onSurface,
                    textDecoration = if (isStruck) TextDecoration.LineThrough else null,
                )
                if (description != null) {
                    Text(
                        text = description,
                        style = MaterialTheme.typography.bodySmall,
                        color = colors.onSurfaceVariant,
                    )
                }
            }
            content?.invoke(this)
        }
    }
}

/** A labelled block inside a tool line (web `ToolSection`): the label is a heading, then [content]. */
@Composable
internal fun AiSection(label: String, modifier: Modifier = Modifier, content: @Composable ColumnScope.() -> Unit) {
    Column(modifier = modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(AedstSpacing.xs)) {
        Text(
            text = label,
            style = MaterialTheme.typography.labelMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.semantics { heading() },
        )
        content()
    }
}

/**
 * [AedstCodeBlock] at most 256dp high that scrolls vertically (web `max-h-64 overflow-auto`). [scrollState] is hoisted
 * so a terminal can keep its newest output in view.
 */
@Composable
internal fun AiCodePanel(
    code: String,
    modifier: Modifier = Modifier,
    language: String? = null,
    onCopy: (() -> Unit)? = null,
    scrollState: ScrollState = rememberScrollState(),
) {
    Box(modifier = modifier.fillMaxWidth().heightIn(max = CODE_MAX_HEIGHT).verticalScroll(scrollState)) {
        AedstCodeBlock(code = code, language = language, onCopy = onCopy)
    }
}

internal val AI_LINE_ICON_SIZE = 16.dp // allow-dp: web size-4 icon
private val LINE_HEIGHT = 20.dp // allow-dp: web h-5, one bodyMedium line
private val STEP_PADDING = 6.dp // allow-dp: web py-1.5
private val CODE_MAX_HEIGHT = 256.dp // allow-dp: web max-h-64
