package com.aedst.feature.auth.data.remote

import com.aedst.core.common.AedstError
import com.aedst.core.common.Logger
import com.aedst.core.common.SignOutHook
import com.aedst.feature.auth.data.local.AuthTokenStore
import com.aedst.feature.auth.domain.model.AuthSession
import com.aedst.feature.auth.domain.model.OidcTokens
import com.aedst.feature.auth.testing.FakeEncryptedPreferences
import com.aedst.feature.auth.testing.FakeOidcAuthorizer
import io.mockk.mockk
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.test.runTest
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNotNull
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertThrows
import org.junit.jupiter.api.Test
import java.io.IOException
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import javax.inject.Provider

class AuthTokenRefresherTest {

    private val authorizer = FakeOidcAuthorizer()
    private val logger: Logger = mockk(relaxed = true)
    private val store = AuthTokenStore(FakeEncryptedPreferences(), CoroutineScope(Dispatchers.Unconfined))
    private val ended = mutableListOf<String>()
    private val hook = object : SignOutHook {
        override suspend fun onSessionEnded() {
            ended += "ended"
        }
    }
    private val refresher = AuthTokenRefresher(store, authorizer, logger, Provider { setOf(hook) })

    private val signedIn = AuthSession("u1", "old-access", "old-refresh", accessExpiresAtEpochSeconds = 10L)

    @Test
    fun `exchanges the refresh token, stores the rotated pair and returns the new access token`() = runTest {
        store.save(signedIn)
        authorizer.refreshResult = OidcTokens("new-access", "new-refresh", 5_900L, subject = "ignored")

        val token = refresher.refresh("old-access")

        assertEquals("new-access", token)
        assertEquals(
            AuthSession("u1", "new-access", "new-refresh", accessExpiresAtEpochSeconds = 5_900L),
            store.session.value,
        )
        assertEquals(listOf("old-refresh"), authorizer.refreshedWith)
    }

    @Test
    fun `keeps the old refresh token when the IdP does not rotate it`() = runTest {
        store.save(signedIn)
        authorizer.refreshResult = OidcTokens("new-access", null, 5_900L, subject = null)

        refresher.refresh("old-access")

        assertEquals("old-refresh", store.session.value?.refreshToken)
        assertEquals("new-access", store.session.value?.accessToken)
    }

    @Test
    fun `reuses a token another caller already refreshed instead of refreshing again`() = runTest {
        store.save(signedIn.copy(accessToken = "already-new"))

        val token = refresher.refresh("old-access")

        assertEquals("already-new", token)
        assertEquals(0, authorizer.refreshCalls)
    }

    @Test
    fun `concurrent callers trigger a single refresh call`() {
        runTest { store.save(signedIn) }
        authorizer.refreshDelayMillis = 50
        val pool = Executors.newFixedThreadPool(8)

        val results = (1..8).map { pool.submit<String?> { refresher.refresh("old-access") } }.map { it.get() }
        pool.shutdown()
        pool.awaitTermination(5, TimeUnit.SECONDS)

        assertEquals(List(8) { "new-access" }, results)
        assertEquals(1, authorizer.refreshCalls)
    }

    @Test
    fun `invalid_grant ends the session`() = runTest {
        store.save(signedIn)
        authorizer.refreshError = AedstError.Unauthenticated("OIDC type=2 code=2002 error=invalid_grant")

        assertNull(refresher.refresh("old-access"))

        assertNull(store.session.value)
        assertEquals(listOf("ended"), ended) // local data of that user is wiped like on an explicit sign-out
    }

    @Test
    fun `an offline device keeps the session so the user stays signed in`() = runTest {
        store.save(signedIn)
        authorizer.refreshError = AedstError.Offline()

        assertThrows(IOException::class.java) { refresher.refresh("old-access") }

        assertNotNull(store.session.value)
        assertEquals("old-refresh", store.session.value?.refreshToken)
        assertEquals(emptyList<String>(), ended)
    }

    @Test
    fun `a server error keeps the session`() = runTest {
        store.save(signedIn)
        authorizer.refreshError = AedstError.Unavailable("HTTP 503")

        assertThrows(IOException::class.java) { refresher.refresh("old-access") }

        assertNotNull(store.session.value)
    }

    @Test
    fun `an unexpected exception is treated as transient and keeps the session`() = runTest {
        store.save(signedIn)
        authorizer.refreshError = IOException("connection reset")

        assertThrows(IOException::class.java) { refresher.refresh("old-access") }

        assertNotNull(store.session.value)
    }

    @Test
    fun `returns null without any network call when nobody is signed in`() = runTest {
        assertNull(refresher.refresh("whatever"))

        assertEquals(0, authorizer.refreshCalls)
    }
}
