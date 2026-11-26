package com.aedst.core.ui.components

import android.content.res.Configuration
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.rememberScrollState
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Delete
import androidx.compose.material.icons.outlined.Terminal
import androidx.compose.material3.Icon
import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.Stable
import androidx.compose.runtime.State
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.snapshotFlow
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.tooling.preview.Preview
import com.aedst.core.ui.R
import com.aedst.core.ui.components.support.AiCodePanel
import com.aedst.core.ui.components.support.AiDisclosure
import com.aedst.core.ui.components.support.rememberAiDisclosure
import com.aedst.core.ui.theme.AedstSpacing
import com.aedst.core.ui.theme.AedstTheme

@Immutable
internal data class AiTerminalState(
    val output: String,
    val isStreaming: Boolean,
    val autoScroll: Boolean,
    val onClear: (() -> Unit)?,
)

/**
 * Receiver of [AedstAiTerminal]'s content: the line's disclosure plus the terminal's output, read by the title, clear
 * button and content parts (extensions on this scope). [terminal] reads snapshot state, so only the parts that read
 * it recompose when the output grows.
 */
@Stable
sealed class AedstAiTerminalScope : AedstAiDisclosureScope() {
    internal abstract val terminal: AiTerminalState
}

private class AiTerminalScopeImpl(override val disclosure: AiDisclosure, private val state: State<AiTerminalState>) :
    AedstAiTerminalScope() {
    override val terminal: AiTerminalState get() = state.value
    override val isStreaming: Boolean get() = state.value.isStreaming
}

/**
 * A shell command the agent runs: a line with the command that opens into its [output] (web `ai-terminal.tsx`).
 * Plain text only: ANSI escape codes are not interpreted, strip them on the server. Uncontrolled, it opens by itself
 * once output arrives while [isStreaming]; after the user toggles it, it stays as they left it. [autoScroll] keeps
 * the newest output in view while streaming; [onClear] enables [AedstAiTerminalClearButton].
 */
@Composable
fun AedstAiTerminal(
    output: String,
    modifier: Modifier = Modifier,
    isStreaming: Boolean = false,
    autoScroll: Boolean = true,
    onClear: (() -> Unit)? = null,
    expanded: Boolean? = null,
    defaultExpanded: Boolean? = null,
    onExpandedChange: ((Boolean) -> Unit)? = null,
    content: @Composable AedstAiTerminalScope.() -> Unit,
) {
    val state = rememberUpdatedState(AiTerminalState(output, isStreaming, autoScroll, onClear))
    val fallback = isStreaming && output.isNotEmpty()
    val disclosure = rememberAiDisclosure(expanded, defaultExpanded, fallback, onExpandedChange)
    val scope = remember(disclosure) { AiTerminalScopeImpl(disclosure, state) }
    Column(modifier = modifier.fillMaxWidth()) { scope.content() }
}

/** The row: [AedstAiTerminalTitle] (give it `Modifier.weight(1f)`) plus [AedstAiTerminalActions] beside it. */
@Composable
fun AedstAiTerminalHeader(modifier: Modifier = Modifier, content: @Composable RowScope.() -> Unit) {
    Row(
        modifier = modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(AedstSpacing.xs),
        verticalAlignment = Alignment.CenterVertically,
        content = content,
    )
}

/**
 * The command line, worded by the caller: "Running pnpm build", "Ran pnpm build", "pnpm lint exited with code 1"
 * (pass `status = ERROR`). Without a [status] it spins while the terminal streams.
 */
@Composable
fun AedstAiTerminalScope.AedstAiTerminalTitle(
    title: String,
    modifier: Modifier = Modifier,
    status: AedstTraceStatus? = null,
    statusLabel: String? = null,
    description: String? = null,
    icon: ImageVector = Icons.Outlined.Terminal,
) {
    val effective = status ?: if (isStreaming) AedstTraceStatus.RUNNING else null
    AedstAiChainOfThoughtHeader(title, modifier, effective, statusLabel, description, icon)
}

@Composable
fun AedstAiTerminalActions(modifier: Modifier = Modifier, content: @Composable RowScope.() -> Unit) {
    Row(
        modifier = modifier,
        horizontalArrangement = Arrangement.spacedBy(AedstSpacing.xs),
        verticalAlignment = Alignment.CenterVertically,
        content = content,
    )
}

/** Ghost icon button named [label] ("Clear output"); rendered only when the terminal has `onClear`. */
@Composable
fun AedstAiTerminalScope.AedstAiTerminalClearButton(label: String, modifier: Modifier = Modifier) {
    val onClear = terminal.onClear ?: return
    AedstIconButton(
        onClick = onClear,
        contentDescription = label,
        modifier = modifier,
        enabled = terminal.output.isNotEmpty(),
        variant = AedstIconButtonVariant.GHOST,
    ) {
        Icon(imageVector = Icons.Outlined.Delete, contentDescription = null)
    }
}

/**
 * The output in a code block (left to right, at most 256dp high, scrolls). While the command runs the block is marked
 * busy ("Loading") and is not a live region, so a screen reader is not flooded with every chunk; once it finishes it
 * becomes a polite live region. [onCopy] shows the copy button when there is output.
 */
@Composable
fun AedstAiTerminalScope.AedstAiTerminalContent(modifier: Modifier = Modifier, onCopy: (() -> Unit)? = null) {
    val scroll = rememberScrollState()
    val shouldFollow by rememberUpdatedState(terminal.autoScroll && terminal.isStreaming)
    LaunchedEffect(scroll) {
        // Follows the end as the output grows; scrollTo (no animation) also honours reduced motion.
        snapshotFlow { scroll.maxValue }.collect { max -> if (shouldFollow) scroll.scrollTo(max) }
    }
    val busy = stringResource(R.string.aedst_a11y_loading)
    val semantics = if (terminal.isStreaming) {
        Modifier.semantics { stateDescription = busy }
    } else {
        Modifier.semantics { liveRegion = LiveRegionMode.Polite }
    }
    AedstAiChainOfThoughtContent(modifier = modifier) {
        AiCodePanel(
            code = terminal.output,
            modifier = semantics,
            onCopy = onCopy?.takeIf { terminal.output.isNotEmpty() },
            scrollState = scroll,
        )
    }
}

@Preview(name = "Light", showBackground = true)
@Preview(name = "Dark", uiMode = Configuration.UI_MODE_NIGHT_YES, showBackground = true)
@Composable
private fun AedstAiTerminalPreview() {
    AedstTheme {
        Surface {
            AedstAiTerminal(output = "> pnpm build\nCompiled successfully", isStreaming = true, onClear = {}) {
                AedstAiTerminalHeader {
                    AedstAiTerminalTitle(title = "Running pnpm build", modifier = Modifier.weight(1f))
                    AedstAiTerminalActions { AedstAiTerminalClearButton(label = "Clear output") }
                }
                AedstAiTerminalContent(onCopy = {})
            }
        }
    }
}
