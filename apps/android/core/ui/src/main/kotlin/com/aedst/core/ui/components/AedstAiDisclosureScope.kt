package com.aedst.core.ui.components

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.runtime.Composable
import androidx.compose.runtime.Stable
import androidx.compose.runtime.State
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.ui.Modifier
import com.aedst.core.ui.components.support.AiDisclosure
import com.aedst.core.ui.components.support.rememberAiDisclosure

/**
 * Receiver of the content of one AI Elements disclosure line: [AedstAiChainOfThought], [AedstAiReasoning],
 * [AedstAiPlan], [AedstAiTask], [AedstAiTool], [AedstAiSubagent], [AedstAiQueueSection], [AedstAiSources],
 * [AedstAiStackTrace], [AedstAiTestResults] and [AedstAiTerminal] (web: the `Collapsible` context behind them).
 *
 * The header and content parts of a line are extensions on this scope, so each part gets the open state of its own
 * line explicitly through the receiver (the innermost line wins when lines nest) and a part outside a line does not
 * compile. The scope is stable for the lifetime of the line; its values read snapshot state, so only the parts that
 * read them recompose when they change.
 */
@Stable
sealed class AedstAiDisclosureScope {
    internal abstract val disclosure: AiDisclosure

    /** True while the line's model or command is still running (reasoning, plan, terminal); drives the spinner. */
    internal abstract val isStreaming: Boolean
}

private class AiDisclosureScopeImpl(override val disclosure: AiDisclosure, private val streaming: State<Boolean>) :
    AedstAiDisclosureScope() {
    override val isStreaming: Boolean get() = streaming.value
}

/**
 * Controlled-or-uncontrolled disclosure line (web `open` / `defaultOpen` / `onOpenChange`): [expanded] wins when set,
 * otherwise the user's last choice (saved across configuration changes), otherwise [fallback] (e.g. "open while
 * streaming"). [content] runs in a full-width column with the line's [AedstAiDisclosureScope].
 */
@Composable
internal fun AiDisclosureLine(
    expanded: Boolean?,
    defaultExpanded: Boolean?,
    fallback: Boolean,
    onExpandedChange: ((Boolean) -> Unit)?,
    modifier: Modifier = Modifier,
    isStreaming: Boolean = false,
    content: @Composable AedstAiDisclosureScope.() -> Unit,
) {
    val disclosure = rememberAiDisclosure(expanded, defaultExpanded, fallback, onExpandedChange)
    val streaming = rememberUpdatedState(isStreaming)
    val scope = remember(disclosure) { AiDisclosureScopeImpl(disclosure, streaming) }
    Column(modifier = modifier.fillMaxWidth()) { scope.content() }
}
