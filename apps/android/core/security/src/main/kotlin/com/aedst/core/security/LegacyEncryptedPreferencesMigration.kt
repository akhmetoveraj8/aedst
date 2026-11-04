package com.aedst.core.security

import android.content.Context
import android.util.Base64
import androidx.datastore.core.DataMigration
import com.google.crypto.tink.Aead
import com.google.crypto.tink.DeterministicAead
import com.google.crypto.tink.RegistryConfiguration
import com.google.crypto.tink.aead.AeadConfig
import com.google.crypto.tink.daead.DeterministicAeadConfig
import com.google.crypto.tink.integration.android.AndroidKeysetManager
import java.nio.ByteBuffer
import java.security.KeyStore

/**
 * One-shot migration of data written by the deprecated
 * `androidx.security:security-crypto` `EncryptedSharedPreferences` (file
 * `aedst_encrypted_prefs`, AES256_SIV key names + AES256_GCM values, master
 * key `_androidx_security_master_key_`) into [TinkEncryptedPreferences].
 *
 * Reads the legacy file with Tink directly (that library was itself a thin
 * Tink wrapper, so its on-disk format is reproduced here without depending on
 * it). DataStore persists the merged result, and only then [cleanUp] deletes
 * the legacy file and Keystore master key: read old -> write new -> delete
 * old. If the legacy data is unreadable (e.g. Keystore key lost after a
 * device restore) it is dropped rather than retried forever — the user simply
 * signs in again. Delete this class once all supported installs have
 * upgraded past the release that introduced it.
 */
internal class LegacyEncryptedPreferencesMigration(private val context: Context) : DataMigration<SecretEntries> {

    override suspend fun shouldMigrate(currentData: SecretEntries): Boolean =
        context.getSharedPreferences(LEGACY_FILE, Context.MODE_PRIVATE).contains(KEY_KEYSET_ALIAS)

    override suspend fun migrate(currentData: SecretEntries): SecretEntries {
        val migrated = runCatching { readLegacyEntries() }.getOrDefault(emptyMap())
        // Values already written by the new store win over legacy ones.
        return SecretEntries(migrated + currentData.entries)
    }

    override suspend fun cleanUp() {
        runCatching { context.deleteSharedPreferences(LEGACY_FILE) }
        runCatching {
            KeyStore.getInstance("AndroidKeyStore").apply { load(null) }.deleteEntry(LEGACY_MASTER_KEY_ALIAS)
        }
    }

    private fun readLegacyEntries(): Map<String, String> {
        AeadConfig.register()
        DeterministicAeadConfig.register()
        val keyNames = keysetManager(KEY_KEYSET_ALIAS).keysetHandle
            .getPrimitive(RegistryConfiguration.get(), DeterministicAead::class.java)
        val values = keysetManager(VALUE_KEYSET_ALIAS).keysetHandle
            .getPrimitive(RegistryConfiguration.get(), Aead::class.java)
        val prefs = context.getSharedPreferences(LEGACY_FILE, Context.MODE_PRIVATE)

        return buildMap {
            prefs.all.forEach { (encryptedKey, raw) ->
                val encryptedValue = raw as? String
                if (encryptedValue != null && encryptedKey !in KEYSET_ALIASES) {
                    runCatching {
                        val key = keyNames.decryptDeterministically(
                            Base64.decode(encryptedKey, Base64.DEFAULT),
                            LEGACY_FILE.toByteArray(),
                        ).decodeToString()
                        val plain = values.decrypt(
                            Base64.decode(encryptedValue, Base64.DEFAULT),
                            encryptedKey.toByteArray(),
                        )
                        decodeString(plain)?.let { put(key, it) }
                    }
                }
            }
        }
    }

    /** Legacy value layout: int type id (0 = String), int length, UTF-8 bytes. */
    private fun decodeString(plain: ByteArray): String? {
        val buffer = ByteBuffer.wrap(plain)
        if (buffer.getInt() != TYPE_STRING) return null
        val bytes = ByteArray(buffer.getInt())
        buffer.get(bytes)
        return bytes.decodeToString().takeIf { it != NULL_VALUE }
    }

    // No key template: the keyset must already exist, otherwise there is nothing to migrate.
    private fun keysetManager(alias: String) = AndroidKeysetManager.Builder()
        .withSharedPref(context, alias, LEGACY_FILE)
        .withMasterKeyUri(LEGACY_MASTER_KEY_URI)
        .build()

    private companion object {
        const val LEGACY_FILE = "aedst_encrypted_prefs"
        const val KEY_KEYSET_ALIAS = "__androidx_security_crypto_encrypted_prefs_key_keyset__"
        const val VALUE_KEYSET_ALIAS = "__androidx_security_crypto_encrypted_prefs_value_keyset__"
        val KEYSET_ALIASES = setOf(KEY_KEYSET_ALIAS, VALUE_KEYSET_ALIAS)
        const val LEGACY_MASTER_KEY_ALIAS = "_androidx_security_master_key_"
        const val LEGACY_MASTER_KEY_URI = "android-keystore://$LEGACY_MASTER_KEY_ALIAS"
        const val NULL_VALUE = "__NULL__"
        const val TYPE_STRING = 0
    }
}
