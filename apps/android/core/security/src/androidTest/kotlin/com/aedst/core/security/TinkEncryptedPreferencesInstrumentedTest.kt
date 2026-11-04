package com.aedst.core.security

import android.content.Context
import androidx.datastore.dataStoreFile
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import com.aedst.core.common.DispatcherProvider
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import java.security.KeyStore
import java.util.Optional

/**
 * The Keystore + Tink secure store on a real Android Keystore (emulator or device), which no JVM test can exercise.
 * Proves: round trip, atomic multi-write, removal, that the file on disk is ciphertext, that the Tink master key lives
 * in the `AndroidKeyStore` provider, and that an unprotected keyset is refused (fail closed).
 *
 * DataStore allows one active instance per file per process, so every test shares [store] and starts from `clear()`.
 */
@RunWith(AndroidJUnit4::class)
class TinkEncryptedPreferencesInstrumentedTest {

    @Before
    fun resetStore() = runBlocking { store.clear() }

    @Test
    fun roundTripsAValue() = runBlocking {
        store.putString("k", "refresh-token-value")

        assertEquals("refresh-token-value", store.getString("k"))
        assertNull(store.getString("missing"))
    }

    @Test
    fun putAllIsOneTransactionAndRemoveDeletesOnlyTheNamedKeys() = runBlocking {
        store.putAll(mapOf("a" to "1", "b" to "2", "c" to "3"))
        store.remove("a", "c")

        assertEquals(mapOf("b" to "2"), store.getAll())
    }

    @Test
    fun theFileOnDiskIsCiphertext() = runBlocking {
        val secret = "PLAINTEXT-MARKER-0123456789"
        store.putString("auth.refresh_token", secret)

        val bytes = context.dataStoreFile("aedst_secure_store.pb").readBytes()

        assertTrue("store file is empty", bytes.isNotEmpty())
        assertFalse("secret found in the clear", String(bytes, Charsets.ISO_8859_1).contains(secret))
        assertFalse("key name found in the clear", String(bytes, Charsets.ISO_8859_1).contains("auth.refresh_token"))
    }

    @Test
    fun theMasterKeyIsInTheAndroidKeystoreAndNotExportable() {
        runBlocking { store.putString("k", "v") } // forces keyset + master key creation
        val keyStore = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }

        assertTrue("master key alias missing", keyStore.containsAlias("aedst_secure_master_key"))
        // A Keystore-resident key never hands out its material: the secret key encoding is null.
        val key = keyStore.getKey("aedst_secure_master_key", null)
        assertNull(key.encoded)
    }

    @Test
    fun refusesAKeysetTheKeystoreDoesNotProtect() {
        assertThrows(IllegalStateException::class.java) { requireKeystoreProtected(isUsingKeystore = false) }
        requireKeystoreProtected(isUsingKeystore = true)
    }

    private companion object {
        val context: Context get() = InstrumentationRegistry.getInstrumentation().targetContext

        val store: TinkEncryptedPreferences by lazy {
            TinkEncryptedPreferences(
                context,
                object : DispatcherProvider {
                    override val main: CoroutineDispatcher = Dispatchers.Main
                    override val io: CoroutineDispatcher = Dispatchers.IO
                    override val default: CoroutineDispatcher = Dispatchers.Default
                },
                Optional.empty(),
            )
        }
    }
}
