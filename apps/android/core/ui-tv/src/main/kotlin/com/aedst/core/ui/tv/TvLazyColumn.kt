package com.aedst.core.ui.tv

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyListScope
import androidx.compose.foundation.lazy.LazyListState
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import com.aedst.core.ui.theme.AedstSpacing

/**
 * Vertical list for 10-foot UI (D-pad up/down navigation, scroll-into-view on
 * focus). Since Compose Foundation 1.7 the standard [LazyColumn] handles
 * D-pad focus traversal itself, and `androidx.tv:tv-foundation`'s
 * `TvLazyColumn` is deprecated in its favour — so this is a thin wrapper that
 * only applies the AEDST spacing default. See [TvLazyRow] for the horizontal axis.
 */
@Composable
fun TvLazyColumn(
    modifier: Modifier = Modifier,
    state: LazyListState = rememberLazyListState(),
    verticalArrangement: Arrangement.Vertical = Arrangement.spacedBy(AedstSpacing.md),
    content: LazyListScope.() -> Unit,
) {
    LazyColumn(
        modifier = modifier,
        state = state,
        verticalArrangement = verticalArrangement,
        content = content,
    )
}
