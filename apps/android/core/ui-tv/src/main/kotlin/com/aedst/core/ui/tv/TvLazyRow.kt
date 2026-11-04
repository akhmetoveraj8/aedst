package com.aedst.core.ui.tv

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.lazy.LazyListScope
import androidx.compose.foundation.lazy.LazyListState
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import com.aedst.core.ui.theme.AedstSpacing

/**
 * Horizontal list for 10-foot UI (D-pad left/right navigation, scroll-into-view
 * on focus). Uses the standard Compose Foundation [LazyRow], which supports
 * D-pad focus traversal natively; `androidx.tv:tv-foundation`'s `TvLazyRow`
 * is deprecated in its favour. Thin wrapper applying the AEDST spacing default.
 */
@Composable
fun TvLazyRow(
    modifier: Modifier = Modifier,
    state: LazyListState = rememberLazyListState(),
    horizontalArrangement: Arrangement.Horizontal = Arrangement.spacedBy(AedstSpacing.md),
    content: LazyListScope.() -> Unit,
) {
    LazyRow(
        modifier = modifier,
        state = state,
        horizontalArrangement = horizontalArrangement,
        content = content,
    )
}
