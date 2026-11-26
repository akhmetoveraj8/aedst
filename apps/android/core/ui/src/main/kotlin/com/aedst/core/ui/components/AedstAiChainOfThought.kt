package com.aedst.core.ui.components

import android.content.res.Configuration
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.FlowRowScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowRight
import androidx.compose.material.icons.outlined.Search
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.NonRestartableComposable
import androidx.compose.runtime.saveable.rememberSaveableStateHolder
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalLayoutDirection
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.LayoutDirection
import com.aedst.core.ui.components.support.AI_LINE_ICON_SIZE
import com.aedst.core.ui.components.support.AiStatusIcon
import com.aedst.core.ui.components.support.AiStepRow
import com.aedst.core.ui.components.support.aiDisclosureStateText
import com.aedst.core.ui.components.support.aiDisclosureToggle
import com.aedst.core.ui.components.support.chevronRotation
import com.aedst.core.ui.components.support.inlineStartRule
import com.aedst.core.ui.theme.AedstShapesScale
import com.aedst.core.ui.theme.AedstSpacing
import com.aedst.core.ui.theme.AedstTheme

/**
 * Collapsible reasoning trail (web `ai-chain-of-thought.tsx`): an [AedstAiChainOfThoughtHeader] and an
 * [AedstAiChainOfThoughtContent] with the steps the agent took. This file owns the line parts every other AI line
 * (reasoning, plan, task, tool, subagent, queue, stack trace, terminal, test results) is built from.
 *
 * The header and content are extensions on the line's [AedstAiDisclosureScope]. Open state is controlled when
 * [expanded] is set, otherwise remembered (saved across configuration changes) from [defaultExpanded];
 * [onExpandedChange] reports every toggle.
 */
@Composable
@NonRestartableComposable
fun AedstAiChainOfThought(
    modifier: Modifier = Modifier,
    expanded: Boolean? = null,
    defaultExpanded: Boolean = false,
    onExpandedChange: ((Boolean) -> Unit)? = null,
    content: @Composable AedstAiDisclosureScope.() -> Unit,
) {
    AiDisclosureLine(expanded, defaultExpanded, defaultExpanded, onExpandedChange, modifier, content = content)
}

/**
 * The disclosure line: the whole row is one button (at least 48dp) whose state description is [statusLabel] plus
 * "Expanded" / "Collapsed". [icon] leads unless [status] is running or error (spinner, cross); [description] is short
 * text after the [title] (a duration, "2 of 5 done"). The chevron mirrors in RTL.
 */
@Composable
fun AedstAiDisclosureScope.AedstAiChainOfThoughtHeader(
    title: String,
    modifier: Modifier = Modifier,
    status: AedstTraceStatus? = null,
    statusLabel: String? = null,
    description: String? = null,
    icon: ImageVector? = null,
) {
    val isExpanded = disclosure.isExpanded
    val stateText = aiDisclosureStateText(isExpanded, statusLabel)
    val muted = MaterialTheme.colorScheme.onSurfaceVariant
    Row(
        modifier = modifier
            .fillMaxWidth()
            .clip(AedstShapesScale.medium)
            .aiDisclosureToggle(isExpanded, stateText, disclosure::setExpanded)
            .heightIn(min = TOUCH_TARGET)
            .padding(horizontal = AedstSpacing.sm),
        horizontalArrangement = Arrangement.spacedBy(AedstSpacing.sm),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        if (icon != null || status != null) AiStatusIcon(status, icon)
        // Title and description share the free width; the title truncates first and the chevron stays at the end.
        Row(
            modifier = Modifier.weight(1f),
            horizontalArrangement = Arrangement.spacedBy(AedstSpacing.sm),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(
                text = title,
                style = MaterialTheme.typography.labelLarge,
                color = muted,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier.weight(1f, fill = false),
            )
            if (description != null) {
                Text(text = description, style = MaterialTheme.typography.labelSmall, color = muted, maxLines = 1)
            }
        }
        Icon(
            imageVector = Icons.AutoMirrored.Filled.KeyboardArrowRight,
            contentDescription = null,
            tint = muted,
            modifier = Modifier
                .size(AI_LINE_ICON_SIZE)
                .rotate(chevronRotation(isExpanded, LocalLayoutDirection.current)),
        )
    }
}

/**
 * Indented panel under a header (inline-start rule, mirrored in RTL); shown while the line is expanded. Saveable state
 * inside it (nested lines' open state) survives collapsing, like web's `keepMounted`.
 */
@Composable
fun AedstAiDisclosureScope.AedstAiChainOfThoughtContent(
    modifier: Modifier = Modifier,
    content: @Composable ColumnScope.() -> Unit,
) {
    val holder = rememberSaveableStateHolder()
    AnimatedVisibility(visible = disclosure.isExpanded) {
        holder.SaveableStateProvider(CONTENT_KEY) {
            Column(
                modifier = modifier
                    .fillMaxWidth()
                    .padding(start = AedstSpacing.lg)
                    .inlineStartRule(MaterialTheme.colorScheme.outlineVariant)
                    .padding(start = AedstSpacing.md, top = AedstSpacing.xs),
                verticalArrangement = Arrangement.spacedBy(AedstSpacing.sm),
                content = content,
            )
        }
    }
}

/** The list that holds [AedstAiChainOfThoughtStep]s. */
@Composable
fun AedstAiChainOfThoughtSteps(modifier: Modifier = Modifier, content: @Composable ColumnScope.() -> Unit) {
    Column(modifier = modifier.fillMaxWidth(), content = content)
}

/**
 * One step: status icon, [label], optional [description] and extra [content] (search results, an image, a file).
 * [status] defaults to success (done); [statusLabel] is the status in words for screen readers.
 */
@Composable
@NonRestartableComposable
fun AedstAiChainOfThoughtStep(
    label: String,
    modifier: Modifier = Modifier,
    description: String? = null,
    status: AedstTraceStatus = AedstTraceStatus.SUCCESS,
    icon: ImageVector? = null,
    statusLabel: String? = null,
    content: (@Composable ColumnScope.() -> Unit)? = null,
) {
    AiStepRow(label, modifier, description, status, icon, statusLabel, content = content)
}

/** A wrapping row of [AedstAiChainOfThoughtSearchResult]s. */
@Composable
fun AedstAiChainOfThoughtSearchResults(modifier: Modifier = Modifier, content: @Composable FlowRowScope.() -> Unit) {
    FlowRow(
        modifier = modifier,
        horizontalArrangement = Arrangement.spacedBy(AedstSpacing.xs),
        verticalArrangement = Arrangement.spacedBy(AedstSpacing.xs),
        content = content,
    )
}

/** One source the agent looked at, as a badge; host names stay left to right in RTL. */
@Composable
fun AedstAiChainOfThoughtSearchResult(
    text: String,
    modifier: Modifier = Modifier,
    variant: AedstBadgeVariant = AedstBadgeVariant.SECONDARY,
) {
    CompositionLocalProvider(LocalLayoutDirection provides LayoutDirection.Ltr) {
        AedstBadge(text = text, modifier = modifier, variant = variant)
    }
}

/** An image the agent looked at: [content] (the caller's image) on a rounded muted frame, then the [caption]. */
@Composable
fun AedstAiChainOfThoughtImage(
    modifier: Modifier = Modifier,
    caption: String? = null,
    content: @Composable () -> Unit,
) {
    Column(modifier = modifier, verticalArrangement = Arrangement.spacedBy(AedstSpacing.xs)) {
        Box(
            modifier = Modifier
                .clip(AedstShapesScale.large)
                .background(MaterialTheme.colorScheme.surfaceVariant),
        ) { content() }
        if (caption != null) {
            Text(
                text = caption,
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}

private val TOUCH_TARGET = AedstSpacing.massive
private const val CONTENT_KEY = "content"

@Preview(name = "Light", showBackground = true)
@Preview(name = "Dark", uiMode = Configuration.UI_MODE_NIGHT_YES, showBackground = true)
@Preview(name = "RTL", locale = "ar", showBackground = true)
@Composable
private fun AedstAiChainOfThoughtPreview() {
    AedstTheme {
        Surface {
            AedstAiChainOfThought(defaultExpanded = true) {
                AedstAiChainOfThoughtHeader(title = "Chain of thought", description = "4 s")
                AedstAiChainOfThoughtContent {
                    AedstAiChainOfThoughtSteps {
                        AedstAiChainOfThoughtStep(label = "Searched the web", icon = Icons.Outlined.Search) {
                            AedstAiChainOfThoughtSearchResults {
                                AedstAiChainOfThoughtSearchResult("react.dev")
                                AedstAiChainOfThoughtSearchResult("developer.android.com")
                            }
                        }
                        AedstAiChainOfThoughtStep(
                            label = "Reading the release notes",
                            status = AedstTraceStatus.RUNNING,
                            statusLabel = "Running",
                        )
                        AedstAiChainOfThoughtStep(label = "Write the answer", status = AedstTraceStatus.PENDING)
                    }
                }
            }
        }
    }
}
