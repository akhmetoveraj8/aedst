package com.aedst.core.media.processing

import android.content.ContentResolver
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.ImageDecoder
import android.net.Uri
import android.os.Build
import androidx.core.graphics.scale
import java.io.File
import javax.inject.Inject
import kotlin.math.max
import kotlin.math.roundToInt

/**
 * Re-encodes a picked image before upload: downscales to [maxDimension] on the long edge and encodes WEBP_LOSSY
 * (API 30+) or JPEG — platform APIs only (ImageDecoder on API 28+, BitmapFactory sampling below). Decoding also
 * applies the EXIF orientation and drops all metadata (GPS location, camera serial), which is a privacy win.
 *
 * Animated images (GIF/animated WebP) are uploaded as-is by the caller; the server produces its own variants anyway.
 */
class ImageCompressor @Inject constructor() {

    data class Result(val file: File, val contentType: String, val extension: String)

    fun compress(
        resolver: ContentResolver,
        source: Uri,
        destinationWithoutExtension: File,
        maxDimension: Int = DEFAULT_MAX_DIMENSION,
        quality: Int = DEFAULT_QUALITY,
    ): Result {
        val bitmap = decodeScaled(resolver, source, maxDimension)
        val (format, contentType, extension) = targetFormat()
        val file = File(destinationWithoutExtension.path + extension)
        try {
            file.outputStream().use { out ->
                check(bitmap.compress(format, quality, out)) { "Bitmap.compress failed" }
            }
        } finally {
            bitmap.recycle()
        }
        return Result(file, contentType, extension)
    }

    private fun decodeScaled(resolver: ContentResolver, source: Uri, maxDimension: Int): Bitmap =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            ImageDecoder.decodeBitmap(ImageDecoder.createSource(resolver, source)) { decoder, info, _ ->
                val longEdge = max(info.size.width, info.size.height)
                if (longEdge > maxDimension) {
                    val scale = maxDimension.toFloat() / longEdge
                    decoder.setTargetSize(
                        (info.size.width * scale).roundToInt().coerceAtLeast(1),
                        (info.size.height * scale).roundToInt().coerceAtLeast(1),
                    )
                }
                // Software bitmap: Bitmap.compress cannot read a HARDWARE bitmap.
                decoder.allocator = ImageDecoder.ALLOCATOR_SOFTWARE
            }
        } else {
            decodeWithBitmapFactory(resolver, source, maxDimension)
        }

    /** API 26–27: power-of-two subsampling (memory-safe), then an exact scale. EXIF rotation is not applied here. */
    private fun decodeWithBitmapFactory(resolver: ContentResolver, source: Uri, maxDimension: Int): Bitmap {
        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        resolver.openInputStream(source).use { BitmapFactory.decodeStream(it, null, bounds) }
        var sample = 1
        while (max(bounds.outWidth, bounds.outHeight) / (sample * 2) >= maxDimension) sample *= 2
        val options = BitmapFactory.Options().apply { inSampleSize = sample }
        val decoded = resolver.openInputStream(source).use { BitmapFactory.decodeStream(it, null, options) }
            ?: error("Unsupported image")
        val longEdge = max(decoded.width, decoded.height)
        if (longEdge <= maxDimension) return decoded
        val scale = maxDimension.toFloat() / longEdge
        val scaled = decoded.scale(
            (decoded.width * scale).roundToInt().coerceAtLeast(1),
            (decoded.height * scale).roundToInt().coerceAtLeast(1),
        )
        if (scaled !== decoded) decoded.recycle()
        return scaled
    }

    private fun targetFormat(): Triple<Bitmap.CompressFormat, String, String> =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            Triple(Bitmap.CompressFormat.WEBP_LOSSY, "image/webp", ".webp")
        } else {
            Triple(Bitmap.CompressFormat.JPEG, "image/jpeg", ".jpg")
        }

    companion object {
        const val DEFAULT_MAX_DIMENSION = 2048
        const val DEFAULT_QUALITY = 85
    }
}
