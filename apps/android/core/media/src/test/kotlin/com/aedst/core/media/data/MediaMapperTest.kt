package com.aedst.core.media.data

import com.aedst.core.media.ImagePreset
import com.aedst.core.media.MediaKind
import com.aedst.core.media.MediaStatus
import com.aedst.core.network.toTimestamp
import com.aedst.media.v1.VariantKind
import com.aedst.media.v1.media
import com.aedst.media.v1.variant
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Test
import java.time.Instant
import com.aedst.media.v1.MediaKind as ProtoMediaKind
import com.aedst.media.v1.MediaStatus as ProtoMediaStatus

class MediaMapperTest {

    @Test
    fun `every known kind maps to its domain kind`() {
        val expected = mapOf(
            ProtoMediaKind.MEDIA_KIND_IMAGE to MediaKind.IMAGE,
            ProtoMediaKind.MEDIA_KIND_VIDEO to MediaKind.VIDEO,
            ProtoMediaKind.MEDIA_KIND_AUDIO to MediaKind.AUDIO,
            ProtoMediaKind.MEDIA_KIND_DOCUMENT to MediaKind.DOCUMENT,
        )

        expected.forEach { (proto, domain) ->
            assertEquals(domain, media { kind = proto }.toDomain().kind, "kind $proto")
        }
    }

    @Test
    fun `an unset or newer kind is unknown, never a guess`() {
        assertEquals(MediaKind.UNKNOWN, media { kind = ProtoMediaKind.MEDIA_KIND_UNSPECIFIED }.toDomain().kind)
        assertEquals(MediaKind.UNKNOWN, media { kindValue = UNKNOWN_ENUM_VALUE }.toDomain().kind)
    }

    @Test
    fun `every known status maps to its domain status`() {
        val expected = mapOf(
            ProtoMediaStatus.MEDIA_STATUS_PENDING_UPLOAD to MediaStatus.PENDING_UPLOAD,
            ProtoMediaStatus.MEDIA_STATUS_PROCESSING to MediaStatus.PROCESSING,
            ProtoMediaStatus.MEDIA_STATUS_READY to MediaStatus.READY,
            ProtoMediaStatus.MEDIA_STATUS_FAILED to MediaStatus.FAILED,
        )

        expected.forEach { (proto, domain) ->
            assertEquals(domain, media { status = proto }.toDomain().status, "status $proto")
        }
    }

    @Test
    fun `an unset or newer status is unknown, not ready or failed`() {
        val unspecified = media { status = ProtoMediaStatus.MEDIA_STATUS_UNSPECIFIED }.toDomain()

        assertEquals(MediaStatus.UNKNOWN, unspecified.status)
        assertEquals(MediaStatus.UNKNOWN, media { statusValue = UNKNOWN_ENUM_VALUE }.toDomain().status)
    }

    @Test
    fun `scalar fields are copied and empty optional strings become null`() {
        val item = media {
            id = "m1"
            filename = "cat.jpg"
            contentType = "image/jpeg"
            sizeBytes = 2_048
            width = 640
            height = 480
            durationMs = 0
            url = "https://cdn.example/m1"
        }.toDomain()

        assertEquals("m1", item.id)
        assertEquals("cat.jpg", item.filename)
        assertEquals(2_048L, item.sizeBytes)
        assertEquals(640, item.width)
        assertEquals("https://cdn.example/m1", item.url)
        assertNull(item.taskId)
        assertNull(item.failureReason)
        assertNull(item.createdAt)
        assertNull(item.posterUrl)
        assertEquals(emptyMap<ImagePreset, String>(), item.presetUrls)
    }

    @Test
    fun `task link, failure reason and creation time are mapped when present`() {
        val created = Instant.parse("2026-03-01T10:15:30Z")

        val item = media {
            taskId = "t1"
            failureReason = "unsupported codec"
            createdAt = created.toTimestamp()
        }.toDomain()

        assertEquals("t1", item.taskId)
        assertEquals("unsupported codec", item.failureReason)
        assertEquals(created, item.createdAt)
    }

    @Test
    fun `variants become presets and the poster, and variants without a url are ignored`() {
        val item = media {
            variants.add(
                variant {
                    kind = VariantKind.VARIANT_KIND_THUMB_64
                    url = "https://img/64"
                },
            )
            variants.add(
                variant {
                    kind = VariantKind.VARIANT_KIND_CARD_400
                    url = "https://img/400"
                },
            )
            variants.add(variant { kind = VariantKind.VARIANT_KIND_FEED_800X600 })
            variants.add(
                variant {
                    kind = VariantKind.VARIANT_KIND_POSTER
                    url = "https://img/poster"
                },
            )
        }.toDomain()

        assertEquals(
            mapOf(ImagePreset.THUMB_64 to "https://img/64", ImagePreset.CARD_400 to "https://img/400"),
            item.presetUrls,
        )
        assertEquals("https://img/poster", item.posterUrl)
    }

    private companion object {
        /** A wire value no enum constant of this build has (a newer server). */
        const val UNKNOWN_ENUM_VALUE = 99
    }
}
