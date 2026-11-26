package com.aedst.core.ui.components

import android.content.res.Configuration
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.lazy.LazyListScope
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.AutoAwesome
import androidx.compose.material3.Icon
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import com.aedst.core.ui.R
import com.aedst.core.ui.theme.AedstSpacing
import com.aedst.core.ui.theme.AedstTheme

/**
 * The thread of a conversation with an agent, mirroring web's `AiChat` + `AiChatContent` + `AiChatScrollButton`
 * (shadcn AI Elements "Chat"). It composes [AedstMessageScroller]: a lazy list named [label] that follows the reply
 * at the live edge while [autoScroll] is on, plus the floating "scroll to end" button ([scrollToEndLabel]).
 *
 * [busy] is web's `aria-busy`: while a reply is submitted or streaming the thread reports "Loading" and the live
 * [AedstAiChatItem] (given the same `busy`) holds its announcement back, so a screen reader reads the finished turn once instead of every
 * token. Put one [AedstAiChatItem] per turn in [content] (pass `Modifier.animateItem()` for the slide-in; Compose
 * animations follow the system "remove animations" setting).
 */
@Composable
fun AedstAiChat(
    modifier: Modifier = Modifier,
    state: AedstMessageScrollerState = rememberAedstMessageScrollerState(),
    busy: Boolean = false,
    autoScroll: Boolean = true,
    contentPadding: PaddingValues = PaddingValues(AedstSpacing.lg),
    label: String = stringResource(R.string.aedst_a11y_messages),
    scrollToEndLabel: String = stringResource(R.string.aedst_a11y_scroll_to_end),
    content: LazyListScope.() -> Unit,
) {
    LaunchedEffect(state, autoScroll) {
        // Off: the thread stays where the reader is until they scroll to the end themselves.
        if (!autoScroll) state.isFollowing = false
    }
    val loading = stringResource(R.string.aedst_a11y_loading)
    AedstMessageScroller(
        modifier = if (busy) modifier.semantics { stateDescription = loading } else modifier,
        state = state,
        contentPadding = contentPadding,
        label = label,
        scrollToEndLabel = scrollToEndLabel,
        content = content,
    )
}

/**
 * One turn in an [AedstAiChat] (web `AiChatItem`); wrap an [AedstAiMessage] in it. Set [live] on the newest
 * assistant turn: it becomes a polite live region once the chat is no longer [busy]. Pass the chat's own `busy`: the
 * items live in lazy item scopes, so the value is handed over explicitly rather than read from the chat.
 */
@Composable
fun AedstAiChatItem(
    from: AedstAiMessageRole,
    modifier: Modifier = Modifier,
    live: Boolean = false,
    busy: Boolean = false,
    content: @Composable () -> Unit,
) {
    val announce = live && from != AedstAiMessageRole.USER && !busy
    AedstMessageScrollerItem(modifier = modifier, announce = announce, content = content)
}

/** Shown instead of the thread before the first turn (web `AiChatEmptyState`), built on [AedstEmpty]. */
@Composable
fun AedstAiChatEmptyState(
    title: String,
    modifier: Modifier = Modifier,
    description: String? = null,
    icon: (@Composable () -> Unit)? = null,
) {
    AedstEmpty(
        title = title,
        modifier = modifier.fillMaxSize(),
        description = description,
        variant = if (icon != null) AedstEmptyVariant.ICON else AedstEmptyVariant.DEFAULT,
        media = icon,
    )
}

@Preview(name = "Light", showBackground = true)
@Preview(name = "Dark", uiMode = Configuration.UI_MODE_NIGHT_YES, showBackground = true)
@Composable
private fun AedstAiChatPreview() {
    AedstTheme {
        Surface {
            AedstAiChat(modifier = Modifier.height(360.dp), busy = true) {
                item {
                    AedstAiChatItem(from = AedstAiMessageRole.USER) {
                        AedstAiMessage(from = AedstAiMessageRole.USER) { AedstAiMessageContent { Text("Hi!") } }
                    }
                }
                item {
                    AedstAiChatItem(from = AedstAiMessageRole.ASSISTANT, live = true, busy = true) {
                        AedstAiMessage(from = AedstAiMessageRole.ASSISTANT) {
                            AedstAiMessageContent { AedstAiMessageResponse("Hello, how can I help?", streaming = true) }
                        }
                    }
                }
            }
        }
    }
}

@Preview(name = "Empty", showBackground = true)
@Composable
private fun AedstAiChatEmptyStatePreview() {
    AedstTheme {
        Surface {
            AedstAiChatEmptyState(
                title = "Start a conversation",
                description = "Ask about your project.",
                icon = { Icon(Icons.Default.AutoAwesome, contentDescription = null) },
            )
        }
    }
}
