package com.aedst.core.ui.components

import android.content.res.Configuration
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.InsertDriveFile
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.ArrowUpward
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.ErrorOutline
import androidx.compose.material.icons.filled.Stop
import androidx.compose.material3.Icon
import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.input.key.onPreviewKeyEvent
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import com.aedst.core.ui.R
import com.aedst.core.ui.components.support.AedstAiPromptInputFile
import com.aedst.core.ui.components.support.AedstAiPromptInputState
import com.aedst.core.ui.components.support.isSubmitKey
import com.aedst.core.ui.components.support.rememberAedstAiPromptInputState
import com.aedst.core.ui.theme.AedstSpacing
import com.aedst.core.ui.theme.AedstTheme

/** Lifecycle of the reply the prompt started (web `AiPromptInputStatus`). */
enum class AedstAiPromptInputStatus { READY, SUBMITTED, STREAMING, ERROR }

private val AedstAiPromptInputStatus.isBusy: Boolean
    get() = this == AedstAiPromptInputStatus.SUBMITTED || this == AedstAiPromptInputStatus.STREAMING

/**
 * The field the person types into to message the agent, mirroring web's `AiPromptInput` (shadcn AI Elements
 * "Prompt Input"): an [AedstInputGroup] with the attachment chips on top ([AedstAiPromptInputHeader]), a growing
 * text area named [label], and a footer with the [tools] (model selector, context), the attach button
 * ([AedstAiPromptInputAttachButton], shown when [onAttachRequest] is set) and the send button
 * ([AedstAiPromptInputSubmit]).
 *
 * A hardware-keyboard Enter sends and Shift+Enter adds a line; the soft keyboard shows a Send action. Sending calls
 * [onSubmit] with the trimmed text and the files and clears the draft ([state]); it is blocked while [status] is
 * submitted or streaming and when the draft is empty. [onAttachRequest] lets the screen launch the system picker and
 * add the result with [AedstAiPromptInputState.addFiles]. With [onStop] the send button stops a streaming reply.
 */
@Composable
fun AedstAiPromptInput(
    onSubmit: (text: String, files: List<AedstAiPromptInputFile>) -> Unit,
    label: String,
    modifier: Modifier = Modifier,
    state: AedstAiPromptInputState = rememberAedstAiPromptInputState(),
    status: AedstAiPromptInputStatus = AedstAiPromptInputStatus.READY,
    placeholder: String? = null,
    enabled: Boolean = true,
    onAttachRequest: (() -> Unit)? = null,
    onStop: (() -> Unit)? = null,
    tools: (@Composable RowScope.() -> Unit)? = null,
) {
    val busy = status.isBusy
    val submit = { state.submit(busy, onSubmit) }
    AedstInputGroup(
        value = state.text,
        onValueChange = { state.text = it },
        label = label,
        modifier = modifier,
        placeholder = placeholder,
        enabled = enabled,
        align = AedstInputGroupAlign.BLOCK_END,
        keyboardOptions = KeyboardOptions(
            capitalization = KeyboardCapitalization.Sentences,
            imeAction = ImeAction.Send,
        ),
        keyboardActions = KeyboardActions(onSend = { submit() }),
        maxLines = MAX_LINES,
        textFieldModifier = Modifier
            .heightIn(min = MIN_FIELD_HEIGHT)
            .padding(vertical = AedstSpacing.xs)
            .onPreviewKeyEvent { event ->
                // Enter never inserts a line break; it sends when the draft can be sent.
                event.isSubmitKey().also { isEnter -> if (isEnter) submit() }
            },
        header = if (state.files.isNotEmpty()) {
            { AedstAiPromptInputHeader(files = state.files, onRemove = state::removeFile) }
        } else {
            null
        },
    ) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(AedstSpacing.xs),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            if (onAttachRequest != null) AedstAiPromptInputAttachButton(onClick = onAttachRequest, enabled = enabled)
            tools?.invoke(this)
            Spacer(Modifier.weight(1f))
            AedstAiPromptInputSubmit(
                status = status,
                onClick = submit,
                enabled = enabled && state.canSubmit(busy),
                onStop = onStop,
            )
        }
    }
}

/**
 * One small attachment chip per file with a remove action (web `AiPromptInputHeader`); renders nothing while
 * [files] is empty. [removeLabel] names each remove button ("Remove report.pdf").
 */
@Composable
fun AedstAiPromptInputHeader(
    files: List<AedstAiPromptInputFile>,
    onRemove: (AedstAiPromptInputFile) -> Unit,
    modifier: Modifier = Modifier,
    removeLabel: @Composable (AedstAiPromptInputFile) -> String = {
        stringResource(R.string.aedst_a11y_remove_attachment, it.name)
    },
) {
    if (files.isEmpty()) return
    AedstAttachmentGroup(modifier = modifier) {
        items(files) { file ->
            AedstAttachment(
                title = file.name,
                size = AedstAttachmentSize.SM,
                media = { AedstAttachmentMedia { Icon(Icons.AutoMirrored.Filled.InsertDriveFile, null) } },
                actions = {
                    AedstAttachmentAction(onClick = { onRemove(file) }, contentDescription = removeLabel(file)) {
                        Icon(Icons.Default.Close, contentDescription = null)
                    }
                },
            )
        }
    }
}

/** Outline "+" button that asks the screen to open the system file picker (web `AiPromptInputAttachButton`). */
@Composable
fun AedstAiPromptInputAttachButton(
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    label: String = stringResource(R.string.aedst_a11y_attach_files),
    enabled: Boolean = true,
) {
    AedstButton(
        text = label,
        onClick = onClick,
        modifier = modifier,
        variant = AedstButtonVariant.OUTLINE,
        size = AedstButtonSize.ICON_SM,
        enabled = enabled,
        leadingIcon = { Icon(Icons.Default.Add, contentDescription = null) },
    )
}

/**
 * The send button (web `AiPromptInputSubmit`); its icon follows [status]: an arrow when ready, a spinner (state
 * "Loading") while submitted or streaming, an error icon (with an error state) after a failure. While streaming
 * with [onStop] set it becomes a stop button named [stopLabel].
 */
@Composable
fun AedstAiPromptInputSubmit(
    status: AedstAiPromptInputStatus,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
    onStop: (() -> Unit)? = null,
    label: String = stringResource(R.string.aedst_a11y_send_message),
    stopLabel: String = stringResource(R.string.aedst_a11y_stop),
) {
    val stoppable = status == AedstAiPromptInputStatus.STREAMING && onStop != null
    val error = stringResource(R.string.aedst_error_unknown)
    AedstButton(
        text = if (stoppable) stopLabel else label,
        onClick = onStop.takeIf { stoppable } ?: onClick,
        modifier = if (status == AedstAiPromptInputStatus.ERROR) {
            modifier.semantics { stateDescription = error }
        } else {
            modifier
        },
        variant = AedstButtonVariant.DEFAULT,
        size = AedstButtonSize.ICON_SM,
        enabled = stoppable || enabled,
        loading = status.isBusy && !stoppable,
        leadingIcon = {
            val icon = when {
                stoppable -> Icons.Default.Stop
                status == AedstAiPromptInputStatus.ERROR -> Icons.Default.ErrorOutline
                else -> Icons.Default.ArrowUpward
            }
            Icon(icon, contentDescription = null)
        },
    )
}

private const val MAX_LINES = 8
private val MIN_FIELD_HEIGHT = 40.dp // web min-h-14 minus the group padding

@Preview(name = "Light", showBackground = true)
@Preview(name = "Dark", uiMode = Configuration.UI_MODE_NIGHT_YES, showBackground = true)
@Composable
private fun AedstAiPromptInputPreview() {
    AedstTheme {
        Surface {
            val state = remember {
                val file = AedstAiPromptInputFile("content://preview/1", "report.pdf")
                AedstAiPromptInputState(initialFiles = listOf(file))
            }
            AedstAiPromptInput(
                onSubmit = { _, _ -> },
                label = "Message",
                modifier = Modifier.padding(AedstSpacing.lg),
                state = state,
                status = AedstAiPromptInputStatus.STREAMING,
                placeholder = "Ask anything",
                onAttachRequest = {},
                onStop = {},
            )
        }
    }
}
