package com.aedst.core.media.ui

import android.net.Uri
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.size
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Description
import androidx.compose.material.icons.filled.PlayCircle
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.unit.dp
import coil3.compose.AsyncImage
import coil3.compose.LocalPlatformContext
import coil3.compose.SubcomposeAsyncImage
import coil3.request.ImageRequest
import coil3.request.crossfade
import com.aedst.core.media.ImagePreset
import com.aedst.core.media.MediaItem
import com.aedst.core.media.MediaKind

/**
 * An image from a presigned URL. Presigned URLs carry a fresh signature on every API read, so the memory/disk cache
 * is keyed by [cacheKey] (media id + variant), not by URL — otherwise every list refresh re-downloads every image.
 */
@Composable
fun MediaImage(
    url: String,
    cacheKey: String,
    contentDescription: String?,
    modifier: Modifier = Modifier,
    contentScale: ContentScale = ContentScale.Crop,
) {
    val context = LocalPlatformContext.current
    val request = remember(url, cacheKey) {
        ImageRequest.Builder(context)
            .data(url)
            .memoryCacheKey(cacheKey)
            .diskCacheKey(cacheKey)
            .crossfade(true)
            .build()
    }
    AsyncImage(
        model = request,
        contentDescription = contentDescription,
        modifier = modifier,
        contentScale = contentScale,
    )
}

/**
 * Square thumbnail for a server-side media item: the imgproxy [preset] variant (or the nearest preset / video poster /
 * original when the server returned none), otherwise a kind icon. Videos get a play glyph overlay. Choose the preset by
 * UI context ([ImagePreset.THUMB_64] tiny lists, [ImagePreset.AVATAR_256] small tiles and avatars,
 * [ImagePreset.CARD_400] grids).
 */
@Composable
fun MediaThumbnail(
    item: MediaItem,
    contentDescription: String?,
    modifier: Modifier = Modifier,
    preset: ImagePreset = ImagePreset.CARD_400,
) {
    Box(modifier = modifier.background(MaterialTheme.colorScheme.surfaceVariant), contentAlignment = Alignment.Center) {
        val imageUrl = item.imageUrl(preset)
        if (imageUrl != null) {
            MediaImage(
                url = imageUrl,
                cacheKey = "${item.id}:${preset.name}",
                contentDescription = contentDescription,
                modifier = Modifier.fillMaxSize(),
            )
        } else {
            KindIcon(item.kind, contentDescription)
        }
        if (item.kind == MediaKind.VIDEO && imageUrl != null) PlayGlyph()
    }
}

/**
 * Thumbnail for a local item that has no server variant yet (an upload in progress). Images are decoded by Coil
 * straight from the content URI; video stills come from [LocalVideoThumbnail], a Coil model resolved by a fetcher that
 * wraps `LocalThumbnailLoader` (MediaStore / MediaMetadataRetriever), so they share Coil's cache and lifecycle.
 */
@Composable
fun LocalMediaThumbnail(uri: Uri, isVideo: Boolean, contentDescription: String?, modifier: Modifier = Modifier) {
    Box(modifier = modifier.background(MaterialTheme.colorScheme.surfaceVariant), contentAlignment = Alignment.Center) {
        if (!isVideo) {
            AsyncImage(
                model = uri,
                contentDescription = contentDescription,
                contentScale = ContentScale.Crop,
                modifier = Modifier.fillMaxSize(),
            )
        } else {
            SubcomposeAsyncImage(
                model = LocalVideoThumbnail(uri),
                contentDescription = contentDescription,
                contentScale = ContentScale.Crop,
                modifier = Modifier.fillMaxSize(),
                loading = { KindIcon(MediaKind.VIDEO, contentDescription) },
                error = { KindIcon(MediaKind.VIDEO, contentDescription) },
            )
            PlayGlyph()
        }
    }
}

/** Stands in for the picture when there is none yet; [contentDescription] keeps the tile nameable by a screen reader. */
@Composable
private fun KindIcon(kind: MediaKind, contentDescription: String?) {
    Icon(
        imageVector = if (kind == MediaKind.VIDEO) Icons.Filled.PlayCircle else Icons.Filled.Description,
        contentDescription = contentDescription,
        tint = MaterialTheme.colorScheme.onSurfaceVariant,
    )
}

@Composable
private fun PlayGlyph() {
    Icon(
        imageVector = Icons.Filled.PlayCircle,
        contentDescription = null,
        tint = MaterialTheme.colorScheme.surface,
        modifier = Modifier.size(32.dp), // allow-dp: icon size, not a spacing step
    )
}
