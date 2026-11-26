package com.aedst.core.ui.components

import android.content.res.Configuration
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Build
import androidx.compose.material3.Icon
import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.runtime.NonRestartableComposable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.tooling.preview.Preview
import com.aedst.core.ui.components.support.AiCodePanel
import com.aedst.core.ui.components.support.AiSection
import com.aedst.core.ui.theme.AedstTheme

/** Lifecycle of a tool call (the AI SDK tool-part states); [status] is its line status. */
enum class AedstAiToolState(val status: AedstTraceStatus) {
    INPUT_STREAMING(AedstTraceStatus.RUNNING),
    INPUT_AVAILABLE(AedstTraceStatus.RUNNING),

    /** Waiting for the user: show [AedstAiToolApproval]. */
    APPROVAL_REQUESTED(AedstTraceStatus.PENDING),
    APPROVAL_RESPONDED(AedstTraceStatus.RUNNING),
    OUTPUT_AVAILABLE(AedstTraceStatus.SUCCESS),
    OUTPUT_ERROR(AedstTraceStatus.ERROR),

    /** The user denied the call. */
    OUTPUT_DENIED(AedstTraceStatus.SKIPPED),
}

/** One tool call as a collapsible line with its input and output (web `ai-tool.tsx`). Closed by default. */
@Composable
@NonRestartableComposable
fun AedstAiTool(
    modifier: Modifier = Modifier,
    expanded: Boolean? = null,
    defaultExpanded: Boolean = false,
    onExpandedChange: ((Boolean) -> Unit)? = null,
    content: @Composable AedstAiDisclosureScope.() -> Unit,
) {
    AedstAiChainOfThought(modifier, expanded, defaultExpanded, onExpandedChange, content)
}

/** The tool line; [title] is tensed by the caller: "Running ls", "Ran ls", "Failed to run ls", "Denied ls". */
@Composable
fun AedstAiDisclosureScope.AedstAiToolHeader(
    state: AedstAiToolState,
    title: String,
    modifier: Modifier = Modifier,
    statusLabel: String? = null,
    description: String? = null,
    icon: ImageVector = Icons.Outlined.Build,
) {
    AedstAiChainOfThoughtHeader(title, modifier, state.status, statusLabel, description, icon)
}

@Composable
@NonRestartableComposable
fun AedstAiDisclosureScope.AedstAiToolContent(
    modifier: Modifier = Modifier,
    content: @Composable ColumnScope.() -> Unit,
) {
    AedstAiChainOfThoughtContent(modifier = modifier, content = content)
}

/**
 * The tool arguments under a heading [label] ("Parameters"), as JSON code at most 256dp high. The caller formats
 * [input] (Android has no JSON pretty-printer in the kit). [onCopy] shows the copy button.
 */
@Composable
fun AedstAiToolInput(label: String, input: String, modifier: Modifier = Modifier, onCopy: (() -> Unit)? = null) {
    AiSection(label, modifier) { AiCodePanel(code = input, language = "json", onCopy = onCopy) }
}

/**
 * The tool result under a heading [label] ("Result"). [errorText] wins and is shown as a destructive alert; otherwise
 * [content] (a custom rendering) or [output] as code. Renders nothing when all three are absent.
 */
@Composable
fun AedstAiToolOutput(
    label: String,
    modifier: Modifier = Modifier,
    output: String? = null,
    errorText: String? = null,
    onCopy: (() -> Unit)? = null,
    content: (@Composable () -> Unit)? = null,
) {
    if (errorText == null && output == null && content == null) return
    AiSection(label, modifier) {
        when {
            errorText != null -> AedstAlert(title = errorText, variant = AedstAlertVariant.DESTRUCTIVE)
            content != null -> content()
            output != null -> AiCodePanel(code = output, onCopy = onCopy)
        }
    }
}

/**
 * The `approval-requested` state: not a line but an outlined item with [title] ("Run ls -la?"), an optional
 * [description] and the Deny / Approve buttons.
 */
@Composable
fun AedstAiToolApproval(
    title: String,
    approveLabel: String,
    denyLabel: String,
    onApprove: () -> Unit,
    onDeny: () -> Unit,
    modifier: Modifier = Modifier,
    description: String? = null,
    icon: ImageVector = Icons.Outlined.Build,
) {
    AedstItem(
        title = title,
        modifier = modifier,
        description = description,
        variant = AedstItemVariant.OUTLINE,
        size = AedstItemSize.SM,
        mediaVariant = AedstItemMediaVariant.ICON,
        media = { Icon(imageVector = icon, contentDescription = null) },
        actions = {
            AedstButton(
                text = denyLabel,
                onClick = onDeny,
                variant = AedstButtonVariant.OUTLINE,
                size = AedstButtonSize.SM,
            )
            AedstButton(text = approveLabel, onClick = onApprove, size = AedstButtonSize.SM)
        },
    )
}

@Preview(name = "Light", showBackground = true)
@Preview(name = "Dark", uiMode = Configuration.UI_MODE_NIGHT_YES, showBackground = true)
@Composable
private fun AedstAiToolPreview() {
    AedstTheme {
        Surface {
            Column {
                AedstAiTool(defaultExpanded = true) {
                    AedstAiToolHeader(state = AedstAiToolState.OUTPUT_AVAILABLE, title = "Ran list_files")
                    AedstAiToolContent {
                        AedstAiToolInput(label = "Parameters", input = "{\n  \"path\": \"src\"\n}", onCopy = {})
                        AedstAiToolOutput(label = "Result", output = "button.tsx\ncard.tsx")
                    }
                }
                AedstAiToolApproval(
                    title = "Run rm -rf build?",
                    description = "The agent wants to run a shell command.",
                    approveLabel = "Approve",
                    denyLabel = "Deny",
                    onApprove = {},
                    onDeny = {},
                )
            }
        }
    }
}
