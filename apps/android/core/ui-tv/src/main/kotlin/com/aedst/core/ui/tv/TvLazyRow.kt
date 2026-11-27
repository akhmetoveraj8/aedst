package com.aedst.core.ui.tv

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.lazy.LazyListScope
import androidx.compose.foundation.lazy.LazyListState
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.focusRestorer
import com.aedst.core.ui.theme.AedstSpacing

/**
 * Horizontal list for 10-foot UI (D-pad left/right navigation, scroll-into-view
 * on focus). Uses the standard Compose Foundation [LazyRow], which supports
 * D-pad focus traversal natively; `androidx.tv:tv-foundation`'s `TvLazyRow`
 * is deprecated in its favour. Thin wrapper applying the AEDST spacing default; it restores focus to the item that
 * had it when focus returns to the row (`focusRestorer`). D-pad left / right follow the layout direction, so in
 * right-to-left locales the row runs right to left.
 */
@Composable
fun TvLazyRow(
    modifier: Modifier = Modifier,
    state: LazyListState = rememberLazyListState(),
    contentPadding: PaddingValues = PaddingValues(AedstSpacing.none),
    horizontalArrangement: Arrangement.Horizontal = Arrangement.spacedBy(AedstSpacing.md),
    content: LazyListScope.() -> Unit,
) {
    LazyRow(
        modifier = modifier.focusRestorer(),
        state = state,
        contentPadding = contentPadding,
        horizontalArrangement = horizontalArrangement,
        content = content,
    )
}
