package com.aedst.feature.auth.data.local

import com.aedst.feature.auth.domain.model.AuthSession
import com.aedst.feature.auth.testing.FakeEncryptedPreferences
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.runTest
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Test

class AuthTokenStoreTest {

    private lateinit var preferences: FakeEncryptedPreferences

    private fun newStore() = AuthTokenStore(preferences, CoroutineScope(Dispatchers.Unconfined))

    @BeforeEach
    fun setUp() {
        preferences = FakeEncryptedPreferences()
    }

    @Test
    fun `starts with no session when preferences are empty`() = runTest {
        val store = newStore()

        assertNull(store.session.value)
        assertNull(store.currentAccessToken())
    }

    @Test
    fun `save persists the session and exposes it via the session flow and currentAccessToken`() = runTest {
        val store = newStore()
        val session = AuthSession("u1", "access-token", "refresh-token", 123L)

        store.save(session)

        assertEquals(session, store.session.value)
        assertEquals("access-token", store.currentAccessToken())
    }

    @Test
    fun `clear removes the session from state and preferences`() = runTest {
        val store = newStore()
        store.save(AuthSession("u1", "access-token", "refresh-token", 123L))

        store.clear()

        assertNull(store.session.value)
        assertNull(store.currentAccessToken())
        assertNull(preferences.getString("auth.access_token"))
    }

    @Test
    fun `a freshly constructed store restores a previously saved session from preferences`() = runTest {
        newStore().save(AuthSession("u1", "access-token", "refresh-token", 123L))

        val restored = newStore()

        assertEquals(AuthSession("u1", "access-token", "refresh-token", 123L), restored.session.value)
    }

    @Test
    fun `restore ignores a partially written session`() = runTest {
        preferences.putString("auth.user_id", "u1")
        preferences.putString("auth.access_token", "access-token")
        // refresh token and expiry deliberately missing

        val store = newStore()

        assertNull(store.session.value)
    }

    @Test
    fun `isRestored is false until the persisted session has been read, then true`() = runTest {
        val dispatcher = StandardTestDispatcher(testScheduler)
        val store = AuthTokenStore(preferences, CoroutineScope(dispatcher))

        assertFalse(store.isRestored.value)

        testScheduler.advanceUntilIdle()

        assertTrue(store.isRestored.value)
    }

    @Test
    fun `awaitSession waits for the restore and returns the persisted session`() = runTest {
        newStore().save(AuthSession("u1", "access-token", "refresh-token", 123L))
        val store = AuthTokenStore(preferences, CoroutineScope(StandardTestDispatcher(testScheduler)))

        val session = store.awaitSession()

        assertEquals("access-token", session?.accessToken)
    }

    @Test
    fun `awaitSession returns null when nobody is signed in`() = runTest {
        assertNull(newStore().awaitSession())
    }
}
