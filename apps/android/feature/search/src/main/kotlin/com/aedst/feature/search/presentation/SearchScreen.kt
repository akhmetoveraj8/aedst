package com.aedst.feature.search.presentation

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Search
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.hilt.lifecycle.viewmodel.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.aedst.core.ui.adaptive.AedstAdaptiveContent
import com.aedst.core.ui.adaptive.AedstContentWidth
import com.aedst.core.ui.adaptive.AedstWindowSizePreviews
import com.aedst.core.ui.components.AedstDivider
import com.aedst.core.ui.components.AedstTextField
import com.aedst.core.ui.components.FullScreenLoading
import com.aedst.core.ui.components.userMessage
import com.aedst.core.ui.theme.AedstSpacing
import com.aedst.core.ui.theme.AedstTheme
import com.aedst.feature.search.R
import com.aedst.feature.search.domain.SearchHit

@Composable
internal fun SearchRoute(onOpenLink: (String) -> Unit, viewModel: SearchViewModel = hiltViewModel()) {
    val state by viewModel.state.collectAsStateWithLifecycle()
    SearchScreen(state = state, onIntent = viewModel::onIntent, onOpenLink = onOpenLink)
}

@Composable
internal fun SearchScreen(state: SearchState, onIntent: (SearchIntent) -> Unit, onOpenLink: (String) -> Unit) {
    // Wide windows (tablet, foldable, desktop mode) get one readable column instead of full-width result rows.
    AedstAdaptiveContent(maxWidth = AedstContentWidth.list) {
        SearchContent(state, onIntent, onOpenLink)
    }
}

@Composable
private fun SearchContent(state: SearchState, onIntent: (SearchIntent) -> Unit, onOpenLink: (String) -> Unit) {
    val focusRequester = remember { FocusRequester() }
    Column(modifier = Modifier.fillMaxSize().padding(top = AedstSpacing.lg)) {
        AedstTextField(
            value = state.query,
            onValueChange = { onIntent(SearchIntent.QueryChanged(it)) },
            placeholder = stringResource(R.string.search_placeholder),
            leadingIcon = { Icon(Icons.Filled.Search, contentDescription = null) },
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = AedstSpacing.lg)
                .focusRequester(focusRequester),
        )
        Box(modifier = Modifier.fillMaxSize().padding(top = AedstSpacing.sm)) {
            when (val result = state.result) {
                SearchResultState.Idle -> Centered(stringResource(R.string.search_hint))
                SearchResultState.Loading -> FullScreenLoading()
                is SearchResultState.Failed -> Centered(result.error.userMessage())
                is SearchResultState.Results ->
                    if (result.hits.isEmpty()) {
                        Centered(stringResource(R.string.search_no_results))
                    } else {
                        HitList(result.hits, onOpenLink)
                    }
            }
        }
    }
}

@Composable
private fun HitList(hits: List<SearchHit>, onOpenLink: (String) -> Unit) {
    val highlight = SpanStyle(
        fontWeight = FontWeight.Bold,
        background = MaterialTheme.colorScheme.primaryContainer,
        color = MaterialTheme.colorScheme.onPrimaryContainer,
    )
    LazyColumn(modifier = Modifier.fillMaxSize()) {
        items(hits, key = { "${it.kind}:${it.id}" }) { hit ->
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .clickable { onOpenLink(hit.link) }
                    .padding(horizontal = AedstSpacing.lg, vertical = AedstSpacing.md),
                verticalArrangement = Arrangement.spacedBy(AedstSpacing.xs),
            ) {
                Text(
                    hit.title,
                    style = MaterialTheme.typography.titleMedium,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
                val snippet = remember(hit.snippet, highlight) { highlightSnippet(hit.snippet, highlight) }
                Text(
                    snippet,
                    style = MaterialTheme.typography.bodyMedium,
                    maxLines = 3,
                    overflow = TextOverflow.Ellipsis,
                )
            }
            AedstDivider()
        }
    }
}

@Composable
private fun Centered(text: String) {
    Box(modifier = Modifier.fillMaxSize().padding(AedstSpacing.xxl), contentAlignment = Alignment.Center) {
        Text(text, style = MaterialTheme.typography.bodyLarge)
    }
}

@AedstWindowSizePreviews
@Composable
private fun SearchScreenWindowSizesPreview() {
    AedstTheme {
        SearchScreen(state = SearchState(query = "report"), onIntent = {}, onOpenLink = {})
    }
}
