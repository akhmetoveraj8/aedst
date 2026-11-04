package com.aedst.core.media.processing

import android.content.Context
import android.graphics.Bitmap
import android.media.MediaMetadataRetriever
import android.media.ThumbnailUtils
import android.net.Uri
import android.os.Build
import android.util.Size
import com.aedst.core.common.DispatcherProvider
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.withContext
import java.io.File
import javax.inject.Inject

/**
 * Thumbnails for media that has **no server variant yet** (an upload in progress, or a file still processing).
 * Once the server's an imgproxy preset variant or `POSTER` exists, UI uses that instead (see `MediaThumbnail`).
 *
 * Order: `ContentResolver.loadThumbnail` (API 29+, cached by MediaStore) → `MediaMetadataRetriever` frame for
 * video → `ThumbnailUtils` for local files.
 */
class LocalThumbnailLoader @Inject constructor(
    @ApplicationContext private val context: Context,
    private val dispatchers: DispatcherProvider,
) {

    suspend fun load(uri: Uri, isVideo: Boolean, sizePx: Int = DEFAULT_SIZE_PX): Bitmap? = withContext(dispatchers.io) {
        runCatching { loadOrThrow(uri, isVideo, sizePx) }.getOrNull()
    }

    @androidx.annotation.RequiresApi(Build.VERSION_CODES.Q)
    private fun loadFromApi29(uri: Uri, isVideo: Boolean, size: Size): Bitmap? {
        if (uri.scheme != "file") return context.contentResolver.loadThumbnail(uri, size, null)
        val file = File(requireNotNull(uri.path))
        return if (isVideo) {
            ThumbnailUtils.createVideoThumbnail(file, size, null)
        } else {
            ThumbnailUtils.createImageThumbnail(file, size, null)
        }
    }

    private fun loadOrThrow(uri: Uri, isVideo: Boolean, sizePx: Int): Bitmap? {
        val size = Size(sizePx, sizePx)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) return loadFromApi29(uri, isVideo, size)
        if (!isVideo) return null // API 26–28 images: Coil decodes content:// URIs directly.
        val retriever = MediaMetadataRetriever()
        return try {
            retriever.setDataSource(context, uri)
            retriever.getFrameAtTime(FRAME_TIME_US, MediaMetadataRetriever.OPTION_CLOSEST_SYNC)
                ?.let { frame -> ThumbnailUtils.extractThumbnail(frame, sizePx, sizePx) }
        } finally {
            retriever.release()
        }
    }

    private companion object {
        const val DEFAULT_SIZE_PX = 256
        const val FRAME_TIME_US = 1_000_000L
    }
}
