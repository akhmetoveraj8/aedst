package com.aedst.core.ui.components

import android.content.res.Configuration
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.EnterTransition
import androidx.compose.animation.ExitTransition
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.scaleIn
import androidx.compose.animation.scaleOut
import androidx.compose.foundation.gestures.scrollBy
import androidx.compose.foundation.interaction.DragInteraction
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyListScope
import androidx.compose.foundation.lazy.LazyListState
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ArrowDownward
import androidx.compose.material3.Icon
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.Stable
import androidx.compose.runtime.derivedStateOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.runtime.snapshotFlow
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.isTraversalGroup
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import com.aedst.core.ui.R
import com.aedst.core.ui.a11y.rememberReducedMotion
import com.aedst.core.ui.theme.AedstSpacing
import com.aedst.core.ui.theme.AedstTheme
import kotlinx.coroutines.flow.collectLatest
import kotlinx.coroutines.launch

/**
 * Scroll state of an [AedstMessageScroller]: the underlying [listState], whether the view follows new content
 * ([isFollowing]: true while the reader is at the end) and [scrollToEnd].
 */
@Stable
class AedstMessageScrollerState(val listState: LazyListState) {
    /** True while new or growing content keeps the view pinned to the end; a drag away from the end clears it. */
    var isFollowing by mutableStateOf(true)
        internal set

    /** True when the last item is fully visible. */
    val isAtEnd: Boolean by derivedStateOf { !listState.canScrollForward }

    /** Scrolls to the very end (the bottom of the last item) and resumes following. */
    suspend fun scrollToEnd(animated: Boolean = false) {
        isFollowing = true
        val last = listState.layoutInfo.totalItemsCount - 1
        if (last < 0) return
        if (animated) listState.animateScrollToItem(last) else listState.scrollToItem(last)
        // The last item may be taller than the viewport: finish the remaining distance.
        var guard = MAX_END_STEPS
        while (listState.canScrollForward && guard-- > 0) {
            listState.scrollBy(listState.layoutInfo.viewportSize.height.toFloat())
        }
    }

    private companion object {
        const val MAX_END_STEPS = 8
    }
}

/** Remembers an [AedstMessageScrollerState]; the conversation opens at its end. */
@Composable
fun rememberAedstMessageScrollerState(): AedstMessageScrollerState {
    val listState = rememberLazyListState()
    return remember(listState) { AedstMessageScrollerState(listState) }
}

/**
 * Chat transcript list, mirroring web's `MessageScroller` (+ `Viewport`, `Content`, `Button`): a lazy column that
 * sticks to the bottom while messages arrive or stream (unless the reader dragged away), plus a "scroll to end" button
 * that appears when the end is out of view. The list is named [label] for accessibility; wrap the newest incoming
 * message in [AedstMessageScrollerItem] with `announce = true` so screen readers read it as it arrives.
 */
@Composable
fun AedstMessageScroller(
    modifier: Modifier = Modifier,
    state: AedstMessageScrollerState = rememberAedstMessageScrollerState(),
    contentPadding: PaddingValues = PaddingValues(AedstSpacing.lg),
    label: String = stringResource(R.string.aedst_a11y_messages),
    scrollToEndLabel: String = stringResource(R.string.aedst_a11y_scroll_to_end),
    content: LazyListScope.() -> Unit,
) {
    val scope = rememberCoroutineScope()
    val reducedMotion = rememberReducedMotion()
    val listState = state.listState
    LaunchedEffect(state) {
        listState.interactionSource.interactions.collect { interaction ->
            when (interaction) {
                is DragInteraction.Start -> state.isFollowing = false
                is DragInteraction.Stop, is DragInteraction.Cancel -> state.isFollowing = !listState.canScrollForward
            }
        }
    }
    LaunchedEffect(state) {
        // Content grew past the end (a new message or a streamed token): follow it while the reader is at the end.
        snapshotFlow { listState.canScrollForward to listState.layoutInfo.totalItemsCount }
            .collectLatest { (canScroll, _) ->
                if (canScroll && state.isFollowing && !listState.isScrollInProgress) state.scrollToEnd()
            }
    }
    Box(modifier = modifier) {
        LazyColumn(
            modifier = Modifier
                .fillMaxSize()
                .semantics {
                    contentDescription = label
                    isTraversalGroup = true
                },
            state = listState,
            contentPadding = contentPadding,
            verticalArrangement = Arrangement.spacedBy(AedstSpacing.xxl),
            content = content,
        )
        AnimatedVisibility(
            visible = !state.isAtEnd,
            modifier = Modifier.align(Alignment.BottomCenter).padding(bottom = AedstSpacing.lg),
            enter = if (reducedMotion) EnterTransition.None else fadeIn() + scaleIn(initialScale = HIDDEN_SCALE),
            exit = if (reducedMotion) ExitTransition.None else fadeOut() + scaleOut(targetScale = HIDDEN_SCALE),
        ) {
            AedstButton(
                text = scrollToEndLabel,
                onClick = { scope.launch { state.scrollToEnd(animated = !reducedMotion) } },
                variant = AedstButtonVariant.SECONDARY,
                size = AedstButtonSize.ICON_SM,
                leadingIcon = { Icon(Icons.Default.ArrowDownward, contentDescription = null) },
            )
        }
    }
}

/**
 * One entry of an [AedstMessageScroller] (web `MessageScrollerItem`). With [announce] the item is a polite live
 * region: set it on the newest incoming message only, so its text is read once it appears or finishes streaming.
 */
@Composable
fun AedstMessageScrollerItem(
    modifier: Modifier = Modifier,
    announce: Boolean = false,
    content: @Composable () -> Unit,
) {
    Box(modifier = if (announce) modifier.semantics { liveRegion = LiveRegionMode.Polite } else modifier) {
        content()
    }
}

private const val HIDDEN_SCALE = 0.95f

@Preview(name = "Light", showBackground = true)
@Preview(name = "Dark", uiMode = Configuration.UI_MODE_NIGHT_YES, showBackground = true)
@Composable
private fun AedstMessageScrollerPreview() {
    AedstTheme {
        Surface {
            AedstMessageScroller(modifier = Modifier.height(320.dp)) {
                items(count = 12) { index ->
                    AedstMessageScrollerItem(announce = index == 11) {
                        AedstMessage(align = if (index % 2 == 0) AedstMessageAlign.START else AedstMessageAlign.END) {
                            AedstBubble(
                                variant = if (index % 2 ==
                                    0
                                ) {
                                    AedstBubbleVariant.MUTED
                                } else {
                                    AedstBubbleVariant.DEFAULT
                                },
                            ) {
                                Text("Message ${index + 1}")
                            }
                        }
                    }
                }
            }
        }
    }
}
