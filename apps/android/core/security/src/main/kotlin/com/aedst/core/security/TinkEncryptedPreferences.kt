package com.aedst.core.security

import android.content.Context
import androidx.datastore.core.DataStore
import androidx.datastore.core.DataStoreFactory
import androidx.datastore.core.handlers.ReplaceFileCorruptionHandler
import androidx.datastore.dataStoreFile
import com.aedst.core.common.DispatcherProvider
import com.aedst.core.common.ErrorReporter
import com.google.crypto.tink.Aead
import com.google.crypto.tink.KeyTemplates
import com.google.crypto.tink.RegistryConfiguration
import com.google.crypto.tink.aead.AeadConfig
import com.google.crypto.tink.integration.android.AndroidKeysetManager
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.first
import java.util.Optional
import javax.inject.Inject
import javax.inject.Singleton

/**
 * [EncryptedPreferences] backed by a DataStore whose file is sealed with a
 * Tink AES-256-GCM [Aead]. The Tink keyset is stored in a private
 * SharedPreferences file and wrapped (envelope-encrypted) by a non-exportable
 * Android Keystore key. Replaces the deprecated `EncryptedSharedPreferences`;
 * data written by that class is migrated on first access by
 * [LegacyEncryptedPreferencesMigration].
 *
 * **Fails closed.** `AndroidKeysetManager` can fall back to a keyset stored in the clear when the Keystore is not
 * usable. This store holds the refresh token, so after the keyset is built [requireKeystoreProtected] refuses to go on
 * unless the Keystore really protects it: the read or write fails (sign-in cannot complete, nothing sensitive is
 * written) and the failure is reported as a non-fatal.
 */
@Singleton
class TinkEncryptedPreferences @Inject constructor(
    @ApplicationContext private val context: Context,
    dispatchers: DispatcherProvider,
    errorReporter: Optional<ErrorReporter>,
) : EncryptedPreferences {

    private val store: DataStore<SecretEntries> = DataStoreFactory.create(
        serializer = AeadSerializer(
            lazy {
                try {
                    createAead(context)
                } catch (@Suppress("TooGenericExceptionCaught") failure: Exception) {
                    errorReporter.ifPresent { it.recordNonFatal(failure) }
                    throw failure
                }
            },
        ),
        corruptionHandler = ReplaceFileCorruptionHandler { SecretEntries() },
        migrations = listOf(LegacyEncryptedPreferencesMigration(context)),
        scope = CoroutineScope(dispatchers.io + SupervisorJob()),
        produceFile = { context.dataStoreFile(FILE_NAME) },
    )

    override suspend fun getString(key: String): String? = getAll()[key]

    override suspend fun getAll(): Map<String, String> = store.data.first().entries

    override suspend fun putString(key: String, value: String) = putAll(mapOf(key to value))

    override suspend fun putAll(entries: Map<String, String>) {
        store.updateData { SecretEntries(it.entries + entries) }
    }

    override suspend fun remove(vararg keys: String) {
        store.updateData { SecretEntries(it.entries - keys.toSet()) }
    }

    override suspend fun clear() {
        store.updateData { SecretEntries() }
    }

    private companion object {
        const val FILE_NAME = "aedst_secure_store.pb"
        const val KEYSET_NAME = "aedst_secure_keyset"
        const val KEYSET_PREFS_FILE = "aedst_secure_keyset_prefs"
        const val MASTER_KEY_URI = "android-keystore://aedst_secure_master_key"

        fun createAead(context: Context): Aead {
            AeadConfig.register()
            val keysetManager = AndroidKeysetManager.Builder()
                .withSharedPref(context, KEYSET_NAME, KEYSET_PREFS_FILE)
                .withKeyTemplate(KeyTemplates.get("AES256_GCM"))
                .withMasterKeyUri(MASTER_KEY_URI)
                .build()
            requireKeystoreProtected(keysetManager.isUsingKeystore)
            return keysetManager.keysetHandle.getPrimitive(RegistryConfiguration.get(), Aead::class.java)
        }
    }
}

/**
 * Refuses a keyset that the Android Keystore does not protect. Separate from [TinkEncryptedPreferences] because the
 * Keystore cannot be exercised on the JVM, while this decision can.
 */
internal fun requireKeystoreProtected(isUsingKeystore: Boolean) {
    check(isUsingKeystore) { "The Tink keyset is not protected by the Android Keystore; refusing to store secrets" }
}
