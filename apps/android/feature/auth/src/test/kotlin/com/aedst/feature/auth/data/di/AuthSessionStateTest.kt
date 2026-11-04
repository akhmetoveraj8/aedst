package com.aedst.feature.auth.data.di

import app.cash.turbine.test
import com.aedst.feature.auth.data.local.AuthTokenStore
import com.aedst.feature.auth.domain.model.AuthSession
import com.aedst.feature.auth.testing.FakeEncryptedPreferences
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.runTest
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Test

class AuthSessionStateTest {

    @Test
    fun `is null while the session is being restored, then reflects whether anyone is signed in`() = runTest {
        val store = AuthTokenStore(FakeEncryptedPreferences(), CoroutineScope(StandardTestDispatcher(testScheduler)))
        val state = AuthSessionState(store, CoroutineScope(UnconfinedTestDispatcher(testScheduler)))

        assertNull(state.isSignedIn.value)

        testScheduler.advanceUntilIdle()

        assertEquals(false, state.isSignedIn.value)
    }

    @Test
    fun `flips to true on sign-in and back to false when the session is cleared`() = runTest {
        val store = AuthTokenStore(FakeEncryptedPreferences(), CoroutineScope(UnconfinedTestDispatcher(testScheduler)))
        val state = AuthSessionState(store, CoroutineScope(UnconfinedTestDispatcher(testScheduler)))

        state.isSignedIn.test {
            assertEquals(false, awaitItem())
            store.save(AuthSession("u1", "access", "refresh", 0L))
            assertEquals(true, awaitItem())
            store.clear()
            assertEquals(false, awaitItem())
        }
    }
}
