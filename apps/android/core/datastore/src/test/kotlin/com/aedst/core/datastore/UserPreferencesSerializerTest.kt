package com.aedst.core.datastore

import androidx.datastore.core.CorruptionException
import com.google.protobuf.InvalidProtocolBufferException
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.test.runTest
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertThrows
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Assumptions.assumeFalse
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.io.TempDir
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.io.File

class UserPreferencesSerializerTest {

    @Test
    fun `the default is an empty document with consent not asked yet`() {
        val default = UserPreferencesSerializer.defaultValue

        assertEquals(AnalyticsConsent.ANALYTICS_CONSENT_UNSET, default.analyticsConsent)
        assertEquals("", default.pushDeviceId)
        assertFalse(default.hasCompletedOnboarding)
    }

    @Test
    fun `an empty file reads as the default`() = runTest {
        val prefs = UserPreferencesSerializer.readFrom(ByteArrayInputStream(ByteArray(0)))

        assertEquals(UserPrefs.getDefaultInstance(), prefs)
    }

    @Test
    fun `every field survives a write and read`() = runTest {
        val prefs = UserPrefs.newBuilder()
            .setLastLoggedInUserId("user-1")
            .setHasCompletedOnboarding(true)
            .setAnalyticsConsent(AnalyticsConsent.ANALYTICS_CONSENT_GRANTED)
            .setPushDeviceId("device-1")
            .setPushRegisteredToken("token-1")
            .setPushRegisteredUserId("user-1")
            .build()
        val out = ByteArrayOutputStream()

        UserPreferencesSerializer.writeTo(prefs, out)

        assertEquals(prefs, UserPreferencesSerializer.readFrom(ByteArrayInputStream(out.toByteArray())))
    }

    @Test
    fun `a consent value written by a newer build reads as unrecognized, not as granted`() = runTest {
        // field 3 (analytics_consent), varint 7: a value this build's enum does not know.
        val fromFuture = byteArrayOf(FIELD_3_VARINT_TAG, 7)

        val prefs = UserPreferencesSerializer.readFrom(ByteArrayInputStream(fromFuture))

        assertEquals(AnalyticsConsent.UNRECOGNIZED, prefs.analyticsConsent)
    }

    @Test
    fun `a truncated document is reported as corruption, not half a document`() {
        val failure = assertThrows(CorruptionException::class.java) {
            runBlocking { UserPreferencesSerializer.readFrom(ByteArrayInputStream(byteArrayOf(0x0A, 0x7F))) }
        }

        // DataStore only hands CorruptionException to its corruptionHandler; the cause stays for diagnostics.
        assertTrue(failure.cause is InvalidProtocolBufferException)
    }

    @Test
    fun `updates are written to the file and read back through the DataStore`(@TempDir dir: File) = runTest {
        val file = File(dir, "user_prefs.pb")
        val store = createUserPrefsDataStore { file }

        store.updateData { it.toBuilder().setPushDeviceId("device-9").build() }

        assertEquals("device-9", store.data.first().pushDeviceId)
        assertTrue(file.length() > 0)
    }

    @Test
    fun `the corruption handler answers with the defaults`() = runTest {
        val replaced = userPrefsCorruptionHandler.handleCorruption(CorruptionException("truncated"))

        assertEquals(UserPrefs.getDefaultInstance(), replaced)
    }

    @Test
    fun `a corrupt file is replaced by the defaults and the store keeps working`(@TempDir dir: File) = runTest {
        // DataStore replaces the file by renaming a temp file over it, which java.io.File cannot do on Windows when the
        // target exists (an Android device and the Linux CI are fine); the handler itself is covered above.
        assumeFalse(System.getProperty("os.name").orEmpty().startsWith("Windows"))
        val file = File(dir, "user_prefs.pb")
        file.writeBytes(byteArrayOf(0x0A, 0x7F)) // a record that claims 127 bytes and has none
        val store = createUserPrefsDataStore { file }

        assertEquals(UserPrefs.getDefaultInstance(), store.data.first())

        store.updateData { it.toBuilder().setPushDeviceId("device-9").build() }
        assertEquals("device-9", store.data.first().pushDeviceId)
        // The healed file on disk is a valid document again (a second DataStore on it would be a second instance).
        assertEquals("device-9", UserPrefs.parseFrom(file.readBytes()).pushDeviceId)
    }

    private companion object {
        /** (field number 3 shl 3) or wire type 0 (varint). */
        const val FIELD_3_VARINT_TAG: Byte = 24
    }
}
