package com.aedst.core.media.data

import com.aedst.core.media.ImagePreset
import com.aedst.core.media.MediaItem
import com.aedst.core.media.MediaKind
import com.aedst.core.media.MediaStatus
import com.aedst.core.network.toInstantOrNull
import com.aedst.media.v1.Media
import com.aedst.media.v1.VariantKind
import com.aedst.media.v1.MediaKind as ProtoMediaKind
import com.aedst.media.v1.MediaStatus as ProtoMediaStatus

// A flat field-by-field mapping with exhaustive enum branches: splitting it only scatters one table.
@Suppress("CyclomaticComplexMethod")
internal fun Media.toDomain(): MediaItem {
    fun variantUrl(kind: VariantKind): String? =
        variantsList.firstOrNull { it.kind == kind }?.url?.takeIf(String::isNotEmpty)

    return MediaItem(
        id = id,
        kind = when (kind) {
            ProtoMediaKind.MEDIA_KIND_IMAGE -> MediaKind.IMAGE
            ProtoMediaKind.MEDIA_KIND_VIDEO -> MediaKind.VIDEO
            ProtoMediaKind.MEDIA_KIND_AUDIO -> MediaKind.AUDIO
            ProtoMediaKind.MEDIA_KIND_DOCUMENT -> MediaKind.DOCUMENT
            ProtoMediaKind.MEDIA_KIND_UNSPECIFIED, ProtoMediaKind.UNRECOGNIZED -> MediaKind.UNKNOWN
        },
        status = when (status) {
            ProtoMediaStatus.MEDIA_STATUS_PENDING_UPLOAD -> MediaStatus.PENDING_UPLOAD
            ProtoMediaStatus.MEDIA_STATUS_PROCESSING -> MediaStatus.PROCESSING
            ProtoMediaStatus.MEDIA_STATUS_READY -> MediaStatus.READY
            ProtoMediaStatus.MEDIA_STATUS_FAILED -> MediaStatus.FAILED
            ProtoMediaStatus.MEDIA_STATUS_UNSPECIFIED, ProtoMediaStatus.UNRECOGNIZED -> MediaStatus.UNKNOWN
        },
        filename = filename,
        contentType = contentType,
        sizeBytes = sizeBytes,
        width = width,
        height = height,
        durationMs = durationMs,
        url = url,
        presetUrls = buildMap {
            variantUrl(VariantKind.VARIANT_KIND_THUMB_64)?.let { put(ImagePreset.THUMB_64, it) }
            variantUrl(VariantKind.VARIANT_KIND_AVATAR_256)?.let { put(ImagePreset.AVATAR_256, it) }
            variantUrl(VariantKind.VARIANT_KIND_CARD_400)?.let { put(ImagePreset.CARD_400, it) }
            variantUrl(VariantKind.VARIANT_KIND_FEED_800X600)?.let { put(ImagePreset.FEED_800X600, it) }
            variantUrl(VariantKind.VARIANT_KIND_STORY_1080X1350)?.let { put(ImagePreset.STORY_1080X1350, it) }
        },
        posterUrl = variantUrl(VariantKind.VARIANT_KIND_POSTER),
        taskId = taskId.takeIf(String::isNotEmpty),
        createdAt = if (hasCreatedAt()) createdAt.toInstantOrNull() else null,
        failureReason = failureReason.takeIf(String::isNotEmpty),
    )
}
