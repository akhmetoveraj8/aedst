package com.aedst.core.ui.components

import android.content.res.Configuration
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Warning
import androidx.compose.material3.Icon
import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.NonRestartableComposable
import androidx.compose.runtime.Stable
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.isTraversalGroup
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.tooling.preview.Preview
import com.aedst.core.ui.theme.AedstSpacing
import com.aedst.core.ui.theme.AedstTheme

/** A tool call's approval lifecycle (web `AiConfirmationState`), without depending on an AI SDK. */
enum class AedstAiConfirmationState { APPROVAL_REQUESTED, APPROVAL_RESPONDED, OUTPUT_DENIED, OUTPUT_AVAILABLE }

/** The approval a tool call carries (web `AiConfirmationApproval`); [approved] is null until the person answers. */
@Immutable
data class AedstAiConfirmationApproval(val id: String, val approved: Boolean? = null, val reason: String? = null)

private enum class Answer { PENDING, ACCEPTED, REJECTED, OTHER }

/**
 * Receiver of [AedstAiConfirmation]'s `media`: carries the answer, which [AedstAiConfirmationRequest],
 * [AedstAiConfirmationAccepted] and [AedstAiConfirmationRejected] (extensions on this scope) read explicitly.
 */
@Stable
sealed interface AedstAiConfirmationScope

private class AiConfirmationScopeImpl(val answer: Answer) : AedstAiConfirmationScope

// The only implementation is AiConfirmationScopeImpl (the scope is sealed), so the cast cannot fail.
private val AedstAiConfirmationScope.answer: Answer get() = (this as AiConfirmationScopeImpl).answer

private fun answerOf(state: AedstAiConfirmationState, approval: AedstAiConfirmationApproval): Answer = when {
    state == AedstAiConfirmationState.APPROVAL_REQUESTED -> Answer.PENDING
    state == AedstAiConfirmationState.OUTPUT_DENIED || approval.approved == false -> Answer.REJECTED
    approval.approved == true -> Answer.ACCEPTED
    else -> Answer.OTHER
}

/**
 * Asks the person for a yes or no before a tool runs, mirroring web's `AiConfirmation` (shadcn AI Elements
 * "Confirmation"): an outline small [AedstItem] with [title], a description and Deny / Approve [actions]
 * ([AedstAiConfirmationAction]). Nothing renders until the call carries an [approval].
 *
 * The description follows the state: [description] while pending (web `AiConfirmationRequest`), [acceptedText] once
 * approved (`AiConfirmationAccepted`), [rejectedText] once denied (`AiConfirmationRejected`). [actions] show only
 * while pending. The item is a traversal group and a polite live region, so the answer is announced. Inside [media]
 * use [AedstAiConfirmationRequest], [AedstAiConfirmationAccepted] and [AedstAiConfirmationRejected] for per-state
 * icons.
 */
@Composable
fun AedstAiConfirmation(
    state: AedstAiConfirmationState,
    approval: AedstAiConfirmationApproval?,
    title: String,
    modifier: Modifier = Modifier,
    description: String? = null,
    acceptedText: String? = null,
    rejectedText: String? = null,
    media: (@Composable AedstAiConfirmationScope.() -> Unit)? = null,
    actions: (@Composable RowScope.() -> Unit)? = null,
) {
    if (approval == null) return
    val answer = answerOf(state, approval)
    val text = when (answer) {
        Answer.PENDING -> description
        Answer.ACCEPTED -> acceptedText ?: description
        Answer.REJECTED -> rejectedText ?: description
        Answer.OTHER -> description
    }
    val scope = remember(answer) { AiConfirmationScopeImpl(answer) }
    AedstItem(
        title = title,
        modifier = modifier.semantics {
            isTraversalGroup = true
            liveRegion = LiveRegionMode.Polite
        },
        description = text,
        variant = AedstItemVariant.OUTLINE,
        size = AedstItemSize.SM,
        mediaVariant = AedstItemMediaVariant.ICON,
        media = media?.let { slot -> { scope.slot() } },
        actions = actions?.takeIf { answer == Answer.PENDING },
    )
}

/** [content] shows only while the approval is pending (web `AiConfirmationRequest`). */
@Composable
fun AedstAiConfirmationScope.AedstAiConfirmationRequest(content: @Composable () -> Unit) {
    if (answer == Answer.PENDING) content()
}

/** [content] shows once the person approved (web `AiConfirmationAccepted`). */
@Composable
fun AedstAiConfirmationScope.AedstAiConfirmationAccepted(content: @Composable () -> Unit) {
    if (answer == Answer.ACCEPTED) content()
}

/** [content] shows once the person denied, or the output was denied (web `AiConfirmationRejected`). */
@Composable
fun AedstAiConfirmationScope.AedstAiConfirmationRejected(content: @Composable () -> Unit) {
    if (answer == Answer.REJECTED) content()
}

/** A small Deny / Approve button (web `AiConfirmationAction`); the default variant is the primary button. */
@Composable
@NonRestartableComposable
fun AedstAiConfirmationAction(
    text: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    variant: AedstButtonVariant = AedstButtonVariant.DEFAULT,
) {
    AedstButton(text = text, onClick = onClick, modifier = modifier, variant = variant, size = AedstButtonSize.SM)
}

@Preview(name = "Light", showBackground = true)
@Preview(name = "Dark", uiMode = Configuration.UI_MODE_NIGHT_YES, showBackground = true)
@Composable
private fun AedstAiConfirmationPreview() {
    AedstTheme {
        Surface {
            Column(
                modifier = Modifier.padding(AedstSpacing.lg),
                verticalArrangement = Arrangement.spacedBy(AedstSpacing.md),
            ) {
                listOf(null, true, false).forEach { approved ->
                    AedstAiConfirmation(
                        state = if (approved == null) {
                            AedstAiConfirmationState.APPROVAL_REQUESTED
                        } else {
                            AedstAiConfirmationState.APPROVAL_RESPONDED
                        },
                        approval = AedstAiConfirmationApproval(id = "call_1", approved = approved),
                        title = "Delete 3 files",
                        description = "The agent wants to delete build/ outputs.",
                        acceptedText = "You approved this action.",
                        rejectedText = "You denied this action.",
                        media = {
                            AedstAiConfirmationRequest { Icon(Icons.Default.Warning, contentDescription = null) }
                            AedstAiConfirmationAccepted { Icon(Icons.Default.Check, contentDescription = null) }
                            AedstAiConfirmationRejected { Icon(Icons.Default.Close, contentDescription = null) }
                        },
                        actions = {
                            AedstAiConfirmationAction("Deny", onClick = {}, variant = AedstButtonVariant.OUTLINE)
                            AedstAiConfirmationAction("Approve", onClick = {})
                        },
                    )
                }
            }
        }
    }
}
