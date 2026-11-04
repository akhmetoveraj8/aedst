package com.aedst.core.media.processing

import android.content.Context
import android.net.Uri
import androidx.annotation.OptIn
import androidx.media3.common.MediaItem
import androidx.media3.common.MimeTypes
import androidx.media3.common.util.UnstableApi
import androidx.media3.effect.Presentation
import androidx.media3.transformer.Composition
import androidx.media3.transformer.EditedMediaItem
import androidx.media3.transformer.Effects
import androidx.media3.transformer.ExportException
import androidx.media3.transformer.ExportResult
import androidx.media3.transformer.Transformer
import com.aedst.core.common.DispatcherProvider
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withContext
import java.io.File
import javax.inject.Inject
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException

/**
 * Re-encodes a picked video with **Media3 Transformer** (hardware codecs): H.264 + AAC in MP4, short side scaled down
 * to [shortSide] px. Typical phone recordings shrink 3–10× before the presigned PUT, which matters on mobile data.
 *
 * Transformer must be driven from a Looper thread, so it is built and started on the main thread; the encode itself
 * runs on Media3's own threads and this function only suspends until the listener fires.
 */
class VideoCompressor @Inject constructor(
    @ApplicationContext private val context: Context,
    private val dispatchers: DispatcherProvider,
) {

    @OptIn(UnstableApi::class)
    suspend fun compress(source: Uri, destination: File, shortSide: Int = DEFAULT_SHORT_SIDE): File =
        withContext(dispatchers.main) {
            suspendCancellableCoroutine { continuation ->
                val transformer = Transformer.Builder(context)
                    .setVideoMimeType(MimeTypes.VIDEO_H264)
                    .setAudioMimeType(MimeTypes.AUDIO_AAC)
                    .addListener(
                        object : Transformer.Listener {
                            override fun onCompleted(composition: Composition, exportResult: ExportResult) {
                                if (continuation.isActive) continuation.resume(destination)
                            }

                            override fun onError(
                                composition: Composition,
                                exportResult: ExportResult,
                                exportException: ExportException,
                            ) {
                                destination.delete()
                                if (continuation.isActive) continuation.resumeWithException(exportException)
                            }
                        },
                    )
                    .build()
                val edited = EditedMediaItem.Builder(MediaItem.fromUri(source))
                    .setEffects(Effects(emptyList(), listOf(Presentation.createForShortSide(shortSide))))
                    .build()
                continuation.invokeOnCancellation {
                    // Called on an arbitrary thread; Transformer.cancel must run on its application looper.
                    android.os.Handler(android.os.Looper.getMainLooper()).post {
                        transformer.cancel()
                        destination.delete()
                    }
                }
                transformer.start(edited, destination.absolutePath)
            }
        }

    companion object {
        const val DEFAULT_SHORT_SIDE = 720
        const val CONTENT_TYPE = "video/mp4"
        const val EXTENSION = ".mp4"
    }
}
