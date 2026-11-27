package com.aedst.core.ui.components

import android.content.res.Configuration
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ContentCopy
import androidx.compose.material.icons.filled.ThumbUpAlt
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.NonRestartableComposable
import androidx.compose.runtime.Stable
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.tooling.preview.Preview
import com.aedst.core.ui.R
import com.aedst.core.ui.theme.AedstSpacing
import com.aedst.core.ui.theme.AedstTheme

/** Who wrote a turn (web `AiMessageRole`). */
enum class AedstAiMessageRole { USER, ASSISTANT, SYSTEM }

/**
 * Receiver of an [AedstAiMessage]'s content: carries the turn's role, which [AedstAiMessageContent] (an extension on
 * this scope) reads explicitly to pick its layout instead of a CompositionLocal.
 */
@Stable
sealed interface AedstAiMessageScope {
    /** Who wrote the enclosing turn. */
    val from: AedstAiMessageRole
}

private class AedstAiMessageScopeImpl(override val from: AedstAiMessageRole) : AedstAiMessageScope

/**
 * One turn of a conversation with an agent, mirroring web's `AiMessage` (shadcn AI Elements "Message"). It composes
 * [AedstMessage]: the person's turn ([AedstAiMessageRole.USER]) is aligned to the end, the agent's to the start.
 * [header] is usually [AedstAiMessageHeader], [actions] holds [AedstAiMessageAction]s (web `AiMessageActions`), and
 * [content] usually one [AedstAiMessageContent].
 */
@Composable
fun AedstAiMessage(
    from: AedstAiMessageRole,
    modifier: Modifier = Modifier,
    header: (@Composable () -> Unit)? = null,
    actions: (@Composable RowScope.() -> Unit)? = null,
    content: @Composable AedstAiMessageScope.() -> Unit,
) {
    val scope = remember(from) { AedstAiMessageScopeImpl(from) }
    AedstMessage(
        modifier = modifier,
        align = if (from == AedstAiMessageRole.USER) AedstMessageAlign.END else AedstMessageAlign.START,
        header = header,
        footer = if (actions != null) {
            { AedstAiMessageActions(content = actions) }
        } else {
            null
        },
    ) { scope.content() }
}

/** Sender name or time above a turn (web `AiMessageHeader`). */
@Composable
@NonRestartableComposable
fun AedstAiMessageHeader(text: String, modifier: Modifier = Modifier) {
    AedstMessageHeader(text = text, modifier = modifier)
}

/** The body of a turn (web `AiMessageContent`): on the person's turn it sits in a muted end-aligned bubble. */
@Composable
fun AedstAiMessageScope.AedstAiMessageContent(
    modifier: Modifier = Modifier,
    content: @Composable ColumnScope.() -> Unit,
) {
    if (from == AedstAiMessageRole.USER) {
        AedstBubble(modifier = modifier, variant = AedstBubbleVariant.MUTED, align = AedstBubbleAlign.END) {
            content()
        }
    } else {
        Column(modifier = modifier, verticalArrangement = Arrangement.spacedBy(AedstSpacing.sm), content = content)
    }
}

/**
 * The agent's reply (web `AiMessageResponse`). The kit ships no markdown renderer: pass [renderMarkdown] to render
 * [text] as markdown, otherwise it is plain text. While [streaming] the reply is marked busy (state "Loading"), the
 * equivalent of web's `aria-busy`, and it is not a live region, so a screen reader is not flooded with every chunk.
 * Set [announce] on the newest reply only: once it stops streaming it becomes a polite live region and the finished
 * text is read once.
 */
@Composable
fun AedstAiMessageResponse(
    text: String,
    modifier: Modifier = Modifier,
    streaming: Boolean = false,
    announce: Boolean = false,
    renderMarkdown: (@Composable (String) -> Unit)? = null,
) {
    val busy = stringResource(R.string.aedst_a11y_loading)
    val semantics = when {
        streaming -> modifier.semantics { stateDescription = busy }
        announce -> modifier.semantics { liveRegion = LiveRegionMode.Polite }
        else -> modifier
    }
    if (renderMarkdown != null) {
        Column(modifier = semantics) { renderMarkdown(text) }
    } else {
        Text(text = text, modifier = semantics, style = MaterialTheme.typography.bodyMedium)
    }
}

/** Row of actions under a turn (web `AiMessageActions`); follows the message alignment. */
@Composable
@NonRestartableComposable
fun AedstAiMessageActions(modifier: Modifier = Modifier, content: @Composable RowScope.() -> Unit) {
    AedstMessageFooter(modifier = modifier, content = content)
}

/**
 * A ghost icon button with a tooltip (web `AiMessageAction`). [label] is the accessible name and the tooltip text
 * unless [tooltip] differs; a null [tooltip] hides it. A non-null [pressed] makes it a toggle (web `aria-pressed`),
 * exposed as the selected state.
 */
@Composable
fun AedstAiMessageAction(
    label: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    tooltip: String? = label,
    pressed: Boolean? = null,
    enabled: Boolean = true,
    icon: @Composable () -> Unit,
) {
    val button: @Composable () -> Unit = {
        AedstButton(
            text = label,
            onClick = onClick,
            modifier = if (pressed != null) modifier.semantics { selected = pressed } else modifier,
            variant = AedstButtonVariant.GHOST,
            size = AedstButtonSize.ICON_SM,
            enabled = enabled,
            leadingIcon = { icon() },
        )
    }
    if (tooltip == null) button() else AedstTooltip(text = tooltip, content = button)
}

@Preview(name = "Light", showBackground = true)
@Preview(name = "Dark", uiMode = Configuration.UI_MODE_NIGHT_YES, showBackground = true)
@Composable
private fun AedstAiMessagePreview() {
    AedstTheme {
        Surface {
            Column(
                modifier = Modifier.padding(AedstSpacing.lg),
                verticalArrangement = Arrangement.spacedBy(AedstSpacing.lg),
            ) {
                AedstAiMessage(from = AedstAiMessageRole.USER) {
                    AedstAiMessageContent { Text("Why did the build fail?") }
                }
                AedstAiMessage(
                    from = AedstAiMessageRole.ASSISTANT,
                    header = { AedstAiMessageHeader("Agent") },
                    actions = {
                        AedstAiMessageAction(label = "Copy", onClick = {}) { Icon(Icons.Default.ContentCopy, null) }
                        AedstAiMessageAction(label = "Good response", onClick = {}, pressed = true) {
                            Icon(Icons.Default.ThumbUpAlt, null)
                        }
                    },
                ) {
                    AedstAiMessageContent { AedstAiMessageResponse("The lockfile is out of date.") }
                }
            }
        }
    }
}
