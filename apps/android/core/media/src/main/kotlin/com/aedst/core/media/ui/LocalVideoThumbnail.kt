package com.aedst.core.media.ui

import android.net.Uri
import coil3.ImageLoader
import coil3.asImage
import coil3.decode.DataSource
import coil3.fetch.FetchResult
import coil3.fetch.Fetcher
import coil3.fetch.ImageFetchResult
import coil3.key.Keyer
import coil3.request.Options
import com.aedst.core.media.processing.LocalThumbnailLoader
import javax.inject.Inject

/**
 * Coil model for "a still of this local video": `AsyncImage(model = LocalVideoThumbnail(uri))`. Coil decodes picked
 * images straight from their content URI, but has no video decoder here; this fetcher fills that gap with
 * [LocalThumbnailLoader] (MediaStore thumbnail / `MediaMetadataRetriever`), so the result goes through Coil's memory
 * cache and request lifecycle instead of a hand-rolled `LaunchedEffect` + bitmap state.
 */
data class LocalVideoThumbnail(val uri: Uri)

internal class LocalVideoThumbnailKeyer : Keyer<LocalVideoThumbnail> {
    override fun key(data: LocalVideoThumbnail, options: Options): String = "local-video:${data.uri}"
}

class LocalVideoThumbnailFetcher(private val model: LocalVideoThumbnail, private val loader: LocalThumbnailLoader) :
    Fetcher {
    /** `null` (no thumbnail available) makes Coil report an error, which the UI shows as the kind icon. */
    override suspend fun fetch(): FetchResult? {
        val bitmap = loader.load(model.uri, isVideo = true) ?: return null
        return ImageFetchResult(image = bitmap.asImage(), isSampled = false, dataSource = DataSource.DISK)
    }

    class Factory @Inject constructor(private val loader: LocalThumbnailLoader) : Fetcher.Factory<LocalVideoThumbnail> {
        override fun create(data: LocalVideoThumbnail, options: Options, imageLoader: ImageLoader): Fetcher =
            LocalVideoThumbnailFetcher(data, loader)
    }
}
