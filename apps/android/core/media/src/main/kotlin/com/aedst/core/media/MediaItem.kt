package com.aedst.core.media

import java.time.Instant

enum class MediaKind { IMAGE, VIDEO, AUDIO, DOCUMENT, UNKNOWN }

enum class MediaStatus { PENDING_UPLOAD, PROCESSING, READY, FAILED, UNKNOWN }

/**
 * imgproxy delivery presets (ADR-0015), smallest to largest; the declaration order is the nearest-fallback order.
 * Pick by UI context: [THUMB_64] tiny lists, [AVATAR_256] avatars and small tiles, [CARD_400] grids/cards (the only
 * uncropped preset), [FEED_800X600] feeds, [STORY_1080X1350] stories.
 */
enum class ImagePreset { THUMB_64, AVATAR_256, CARD_400, FEED_800X600, STORY_1080X1350 }

/**
 * Domain view of `aedst.media.v1.Media`. URLs are short-lived presigned GETs: never persist them, and key image
 * caches by [id] + variant (see `MediaImage`), not by URL.
 */
data class MediaItem(
    val id: String,
    val kind: MediaKind,
    val status: MediaStatus,
    val filename: String,
    val contentType: String,
    val sizeBytes: Long,
    val width: Int,
    val height: Int,
    val durationMs: Long,
    /** Original; empty until [MediaStatus.READY]. */
    val url: String,
    /** Signed imgproxy URLs by preset (empty until processing finishes or when the server has imgproxy disabled). */
    val presetUrls: Map<ImagePreset, String>,
    /** Stored video poster frame, if any. */
    val posterUrl: String?,
    val taskId: String?,
    val createdAt: Instant?,
    val failureReason: String?,
) {
    /**
     * Image URL for [preset]: that preset, else the nearest preset the server returned, else the video poster, else
     * the original image (only when no variant exists at all).
     */
    fun imageUrl(preset: ImagePreset): String? {
        val nearest = ImagePreset.entries
            .sortedBy { kotlin.math.abs(it.ordinal - preset.ordinal) }
            .firstNotNullOfOrNull { presetUrls[it] }
        return nearest ?: posterUrl ?: url.takeIf { kind == MediaKind.IMAGE && it.isNotEmpty() }
    }

    /**
     * URL to display/play in full. Presets are fixed boxes (most crop), so the uncropped full view and playback use
     * the sanitized original; it falls back to [ImagePreset.CARD_400] only when the original URL is empty.
     */
    val displayUrl: String?
        get() = url.takeIf { it.isNotEmpty() } ?: if (kind == MediaKind.IMAGE) imageUrl(ImagePreset.CARD_400) else null
}

data class MediaPage(val items: List<MediaItem>, val nextPageToken: String?)
