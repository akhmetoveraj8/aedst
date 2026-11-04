package com.aedst.feature.media.presentation.library

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.GridItemSpan
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.AddPhotoAlternate
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.hilt.lifecycle.viewmodel.compose.hiltViewModel
import androidx.lifecycle.compose.LifecycleStartEffect
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.aedst.core.media.MediaItem
import com.aedst.core.media.ui.MediaThumbnail
import com.aedst.core.media.ui.UploadProgressRow
import com.aedst.core.media.ui.rememberMediaPicker
import com.aedst.core.media.upload.UploadProgress
import com.aedst.core.ui.adaptive.AedstAdaptiveContent
import com.aedst.core.ui.adaptive.AedstContentWidth
import com.aedst.core.ui.adaptive.AedstWindowSizePreviews
import com.aedst.core.ui.components.AedstButton
import com.aedst.core.ui.components.AedstButtonVariant
import com.aedst.core.ui.components.AedstErrorSnackbarEffect
import com.aedst.core.ui.components.AedstFab
import com.aedst.core.ui.components.AedstSnackbarHost
import com.aedst.core.ui.components.AedstTopAppBar
import com.aedst.core.ui.components.FullScreenLoading
import com.aedst.core.ui.theme.AedstShapesScale
import com.aedst.core.ui.theme.AedstSpacing
import com.aedst.core.ui.theme.AedstTheme
import com.aedst.feature.media.R

@Composable
internal fun MediaLibraryRoute(onOpenMedia: (String) -> Unit, viewModel: MediaLibraryViewModel = hiltViewModel()) {
    val state by viewModel.state.collectAsStateWithLifecycle()
    val uploads by viewModel.activeUploads.collectAsStateWithLifecycle()
    // The one place the library loads: every start (first open, and coming back from a detail screen or the picker).
    LifecycleStartEffect(viewModel) {
        viewModel.onIntent(MediaLibraryIntent.Refresh)
        onStopOrDispose { }
    }
    MediaLibraryScreen(state = state, uploads = uploads, onOpenMedia = onOpenMedia, onIntent = viewModel::onIntent)
}

@Composable
internal fun MediaLibraryScreen(
    state: MediaLibraryState,
    uploads: List<UploadProgress>,
    onOpenMedia: (String) -> Unit,
    onIntent: (MediaLibraryIntent) -> Unit,
) {
    val snackbarHostState = remember { SnackbarHostState() }
    AedstErrorSnackbarEffect(
        state.error,
        snackbarHostState,
        onShown = { onIntent(MediaLibraryIntent.ErrorShown) },
        onRetry = { onIntent(MediaLibraryIntent.Refresh) },
    )
    val pickMedia = rememberMediaPicker { uris -> onIntent(MediaLibraryIntent.Upload(uris)) }

    Scaffold(
        topBar = { AedstTopAppBar(title = stringResource(R.string.media_title)) },
        snackbarHost = { AedstSnackbarHost(snackbarHostState) },
        floatingActionButton = {
            AedstFab(onClick = pickMedia, contentDescription = stringResource(R.string.media_upload)) {
                Icon(Icons.Filled.AddPhotoAlternate, contentDescription = null)
            }
        },
    ) { padding ->
        AedstAdaptiveContent(modifier = Modifier.padding(padding), maxWidth = AedstContentWidth.wide) {
            LibraryContent(
                state = state,
                uploads = uploads,
                onOpenMedia = onOpenMedia,
                onCancelUpload = { onIntent(MediaLibraryIntent.CancelUpload(it)) },
                onLoadMore = { onIntent(MediaLibraryIntent.LoadMore) },
            )
        }
    }
}

@Composable
private fun LibraryContent(
    state: MediaLibraryState,
    uploads: List<UploadProgress>,
    onOpenMedia: (String) -> Unit,
    onCancelUpload: (String) -> Unit,
    onLoadMore: () -> Unit,
) {
    when {
        state.isLoading && state.items.isEmpty() && uploads.isEmpty() ->
            FullScreenLoading()
        state.items.isEmpty() && uploads.isEmpty() ->
            Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                Text(stringResource(R.string.media_empty), style = MaterialTheme.typography.bodyLarge)
            }
        else -> MediaGrid(state, uploads, onOpenMedia, onCancelUpload, onLoadMore)
    }
}

@Composable
private fun MediaGrid(
    state: MediaLibraryState,
    uploads: List<UploadProgress>,
    onOpenMedia: (String) -> Unit,
    onCancelUpload: (String) -> Unit,
    onLoadMore: () -> Unit,
    modifier: Modifier = Modifier,
) {
    LazyVerticalGrid(
        columns = GridCells.Adaptive(minSize = 112.dp), // allow-dp: grid cell width, not a spacing step
        modifier = modifier.fillMaxSize(),
        contentPadding = PaddingValues(AedstSpacing.sm),
        horizontalArrangement = Arrangement.spacedBy(AedstSpacing.sm),
        verticalArrangement = Arrangement.spacedBy(AedstSpacing.sm),
    ) {
        items(uploads, key = { it.uploadId }, span = { GridItemSpan(maxLineSpan) }) { upload ->
            UploadProgressRow(upload = upload, onCancel = { onCancelUpload(upload.uploadId) })
        }
        items(state.items, key = MediaItem::id) { item ->
            MediaThumbnail(
                item = item,
                contentDescription = item.filename,
                modifier = Modifier
                    .aspectRatio(1f)
                    .clip(AedstShapesScale.medium)
                    .clickable { onOpenMedia(item.id) },
            )
        }
        if (state.nextPageToken != null) {
            item(span = { GridItemSpan(maxLineSpan) }) {
                AedstButton(
                    text = stringResource(R.string.media_load_more),
                    onClick = onLoadMore,
                    variant = AedstButtonVariant.GHOST,
                    loading = state.isLoadingMore,
                    modifier = Modifier.fillMaxWidth(),
                )
            }
        }
    }
}

@AedstWindowSizePreviews
@Composable
private fun MediaLibraryScreenPreview() {
    AedstTheme {
        MediaLibraryScreen(
            state = MediaLibraryState(isLoading = false),
            uploads = emptyList(),
            onOpenMedia = {},
            onIntent = {},
        )
    }
}
