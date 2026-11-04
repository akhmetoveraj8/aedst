package com.aedst.core.security

import android.content.Context
import androidx.test.core.app.ApplicationProvider
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

/**
 * Robolectric (JUnit 4 runner, see libs.versions.toml) for SharedPreferences. The Android Keystore is not available on
 * the JVM, which is exactly the "legacy keys lost" situation the migration must survive without crashing.
 */
@RunWith(RobolectricTestRunner::class)
class LegacyEncryptedPreferencesMigrationTest {

    private val context: Context = ApplicationProvider.getApplicationContext()
    private val migration = LegacyEncryptedPreferencesMigration(context)

    private fun legacyPrefs() = context.getSharedPreferences(LEGACY_FILE, Context.MODE_PRIVATE)

    @Test
    fun `a fresh install has nothing to migrate`() = runBlocking {
        assertFalse(migration.shouldMigrate(SecretEntries()))
    }

    @Test
    fun `the legacy file is detected by its key keyset entry`() = runBlocking {
        legacyPrefs().edit().putString(KEY_KEYSET_ALIAS, "keyset").commit()

        assertTrue(migration.shouldMigrate(SecretEntries()))
    }

    @Test
    fun `unreadable legacy data is dropped and existing entries are kept`() = runBlocking {
        legacyPrefs().edit().putString(KEY_KEYSET_ALIAS, "not-a-keyset").commit()
        val current = SecretEntries(mapOf("auth.access_token" to "new"))

        val migrated = migration.migrate(current)

        assertEquals(current, migrated)
    }

    @Test
    fun `clean up removes the legacy file even without a Keystore`() = runBlocking {
        legacyPrefs().edit().putString(KEY_KEYSET_ALIAS, "keyset").commit()

        migration.cleanUp()

        assertFalse(migration.shouldMigrate(SecretEntries()))
    }

    private companion object {
        const val LEGACY_FILE = "aedst_encrypted_prefs"
        const val KEY_KEYSET_ALIAS = "__androidx_security_crypto_encrypted_prefs_key_keyset__"
    }
}
