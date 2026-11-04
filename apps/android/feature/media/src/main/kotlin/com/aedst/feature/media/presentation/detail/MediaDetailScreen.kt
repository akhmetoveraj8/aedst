package com.aedst.feature.media.presentation.detail

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.ReadOnlyComposable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.res.stringResource
import androidx.hilt.lifecycle.viewmodel.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.aedst.core.media.MediaItem
import com.aedst.core.media.MediaKind
import com.aedst.core.media.MediaStatus
import com.aedst.core.media.ui.MediaImage
import com.aedst.core.media.ui.VideoPlayer
import com.aedst.core.ui.adaptive.AedstAdaptiveContent
import com.aedst.core.ui.adaptive.AedstContentWidth
import com.aedst.core.ui.adaptive.AedstWidthClass
import com.aedst.core.ui.adaptive.AedstWindowSizePreviews
import com.aedst.core.ui.adaptive.rememberAedstWidthClass
import com.aedst.core.ui.components.AedstErrorSnackbarEffect
import com.aedst.core.ui.components.AedstIconButton
import com.aedst.core.ui.components.AedstSnackbarHost
import com.aedst.core.ui.components.AedstTopAppBar
import com.aedst.core.ui.components.FullScreenLoading
import com.aedst.core.ui.theme.AedstSpacing
import com.aedst.core.ui.theme.AedstTheme
import com.aedst.feature.media.R

@Composable
internal fun MediaDetailRoute(
    mediaId: String,
    onBack: () -> Unit,
    viewModel: MediaDetailViewModel = hiltViewModel<MediaDetailViewModel, MediaDetailViewModel.Factory>(
        creationCallback = { factory -> factory.create(mediaId) },
    ),
) {
    val state by viewModel.state.collectAsStateWithLifecycle()
    val currentOnBack by rememberUpdatedState(onBack)
    LaunchedEffect(viewModel) {
        viewModel.effects.collect { effect ->
            when (effect) {
                MediaDetailEffect.Deleted -> currentOnBack()
            }
        }
    }
    MediaDetailScreen(state = state, onIntent = viewModel::onIntent, onBack = onBack)
}

@Composable
internal fun MediaDetailScreen(
    state: MediaDetailState,
    onIntent: (MediaDetailIntent) -> Unit,
    onBack: () -> Unit,
    widthClass: AedstWidthClass = rememberAedstWidthClass(),
) {
    val snackbarHostState = remember { SnackbarHostState() }
    AedstErrorSnackbarEffect(state.error, snackbarHostState, onShown = { onIntent(MediaDetailIntent.ErrorShown) })

    Scaffold(
        topBar = {
            AedstTopAppBar(
                title = state.item?.filename.orEmpty(),
                navigationIcon = {
                    AedstIconButton(
                        onClick = onBack,
                        contentDescription = stringResource(R.string.media_back),
                    ) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = null)
                    }
                },
                actions = {
                    if (state.item != null) {
                        AedstIconButton(
                            onClick = { onIntent(MediaDetailIntent.Delete) },
                            contentDescription = stringResource(R.string.media_delete),
                            enabled = !state.isDeleting,
                        ) {
                            Icon(Icons.Filled.Delete, contentDescription = null)
                        }
                    }
                },
            )
        },
        snackbarHost = { AedstSnackbarHost(snackbarHostState) },
    ) { padding ->
        val item = state.item
        when {
            item == null -> if (state.isLoading) FullScreenLoading(Modifier.padding(padding))
            else -> {
                val expanded = widthClass == AedstWidthClass.EXPANDED
                val maxWidth = if (expanded) AedstContentWidth.wide else AedstContentWidth.reading
                AedstAdaptiveContent(modifier = Modifier.padding(padding), maxWidth = maxWidth) {
                    MediaDetailBody(item, widthClass)
                }
            }
        }
    }
}

/**
 * Phones and medium windows stack the media above its status; expanded windows put the media (two thirds) beside the
 * information column, so a landscape tablet does not show a small player in a sea of empty space.
 */
@Composable
internal fun MediaDetailBody(item: MediaItem, widthClass: AedstWidthClass) {
    if (widthClass == AedstWidthClass.EXPANDED) {
        Row(
            modifier = Modifier.fillMaxSize().padding(AedstSpacing.lg),
            horizontalArrangement = Arrangement.spacedBy(AedstSpacing.xxl),
        ) {
            Box(modifier = Modifier.weight(2f), contentAlignment = Alignment.Center) { MediaContent(item) }
            Column(modifier = Modifier.weight(1f)) { MediaStatusText(item) }
        }
    } else {
        Column(modifier = Modifier.fillMaxSize(), verticalArrangement = Arrangement.spacedBy(AedstSpacing.md)) {
            MediaContent(item)
            MediaStatusText(item, Modifier.padding(horizontal = AedstSpacing.lg))
        }
    }
}

@Composable
private fun MediaStatusText(item: MediaItem, modifier: Modifier = Modifier) {
    Text(text = statusText(item), style = MaterialTheme.typography.bodyMedium, modifier = modifier)
}

@Composable
private fun MediaContent(item: MediaItem) {
    val url = item.displayUrl
    val ratio = if (item.width > 0 && item.height > 0) item.width.toFloat() / item.height else DEFAULT_RATIO
    val frame = Modifier.fillMaxWidth().aspectRatio(ratio)
    when {
        url == null -> Box(frame, contentAlignment = Alignment.Center) {
            Text(stringResource(R.string.media_processing))
        }
        item.kind == MediaKind.VIDEO -> VideoPlayer(url = url, modifier = frame)
        item.kind == MediaKind.IMAGE -> MediaImage(
            url = url,
            cacheKey = "${item.id}:display",
            contentDescription = item.filename,
            modifier = frame,
            contentScale = ContentScale.Fit,
        )
        else -> Box(frame, contentAlignment = Alignment.Center) { Text(item.contentType) }
    }
}

@Composable
@ReadOnlyComposable
private fun statusText(item: MediaItem): String = when (item.status) {
    MediaStatus.READY -> stringResource(R.string.media_status_ready)
    MediaStatus.FAILED -> stringResource(R.string.media_status_failed)
    // UNKNOWN (a status newer than this build) is shown as in-progress rather than as ready or failed.
    MediaStatus.PENDING_UPLOAD,
    MediaStatus.PROCESSING,
    MediaStatus.UNKNOWN,
    -> stringResource(R.string.media_processing)
}

private const val DEFAULT_RATIO = 16f / 9f

@AedstWindowSizePreviews
@Composable
private fun MediaDetailScreenPreview() {
    AedstTheme {
        MediaDetailScreen(
            state = MediaDetailState(isLoading = false),
            onIntent = {},
            onBack = {},
        )
    }
}
