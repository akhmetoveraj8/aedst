package com.aedst.feature.auth.data.local

import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import com.aedst.core.common.DispatcherProvider
import com.aedst.core.security.TinkEncryptedPreferences
import com.aedst.feature.auth.domain.model.AuthSession
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import java.util.Optional

/**
 * Token store round trip on the real Keystore + Tink store, no AppAuth involved: a saved session survives a "process
 * restart" (a second [AuthTokenStore] over the same encrypted file restores it), and `clear()` removes it for good.
 * DataStore allows one instance per file per process, so the encrypted store is shared and the AuthTokenStores are
 * the things that are recreated.
 */
@RunWith(AndroidJUnit4::class)
class AuthTokenStoreInstrumentedTest {

    private val scopes = mutableListOf<CoroutineScope>()

    private fun newStore(): AuthTokenStore {
        val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default).also(scopes::add)
        return AuthTokenStore(encrypted, scope)
    }

    @Before
    fun wipe() = runBlocking { encrypted.clear() }

    @After
    fun cancelScopes() = scopes.forEach { it.cancel() }

    @Test
    fun savedSessionIsRestoredByAFreshStore() = runBlocking {
        newStore().save(SESSION)

        val restored = newStore()

        assertEquals(SESSION, restored.awaitSession())
        assertTrue(restored.isRestored.value)
        assertEquals(SESSION.accessToken, restored.currentAccessToken())
    }

    @Test
    fun clearRemovesTheSessionFromTheEncryptedFile() = runBlocking {
        val first = newStore()
        first.save(SESSION)
        first.clear()

        assertNull(first.currentAccessToken())
        assertNull(newStore().awaitSession())
        assertTrue(encrypted.getAll().isEmpty())
    }

    @Test
    fun anIncompleteRecordRestoresAsSignedOut() = runBlocking {
        encrypted.putString("auth.user_id", "u-1") // access/refresh/expiry missing

        assertNull(newStore().awaitSession())
    }

    private companion object {
        val SESSION = AuthSession("u-1", "access-token", "refresh-token", 1_900_000_000L)

        val encrypted: TinkEncryptedPreferences by lazy {
            TinkEncryptedPreferences(
                InstrumentationRegistry.getInstrumentation().targetContext,
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
