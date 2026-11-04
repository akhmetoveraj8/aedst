package com.aedst.feature.auth.data.repository

import com.aedst.core.common.AedstError
import com.aedst.core.common.Logger
import com.aedst.core.common.SignOutHook
import com.aedst.feature.auth.data.attestation.SignInAttestation
import com.aedst.feature.auth.data.local.AuthTokenStore
import com.aedst.feature.auth.domain.model.AuthSession
import com.aedst.feature.auth.domain.model.AuthorizationCallback
import com.aedst.feature.auth.domain.model.AuthorizationLaunch
import com.aedst.feature.auth.domain.model.BeginSignInResult
import com.aedst.feature.auth.domain.model.DeviceSignInResult
import com.aedst.feature.auth.domain.model.DeviceTokenResult
import com.aedst.feature.auth.domain.model.OidcTokens
import com.aedst.feature.auth.domain.model.SignInResult
import com.aedst.feature.auth.domain.repository.TokenRevoker
import com.aedst.feature.auth.testing.FakeDeviceAuthorizer
import com.aedst.feature.auth.testing.FakeEncryptedPreferences
import com.aedst.feature.auth.testing.FakeOidcAuthorizer
import io.mockk.mockk
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.test.runTest
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertSame
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import java.io.IOException

class OidcAuthRepositoryTest {

    private val authorizer = FakeOidcAuthorizer()
    private val deviceAuthorizer = FakeDeviceAuthorizer()
    private val revoked = mutableListOf<String>()
    private var revokeAction: suspend (String) -> Unit = { revoked += it }
    private val revoker = TokenRevoker { token -> revokeAction(token) }
    private val tokenStore = AuthTokenStore(FakeEncryptedPreferences(), CoroutineScope(Dispatchers.Unconfined))
    private val logger: Logger = mockk(relaxed = true)
    private val callback = AuthorizationCallback("result-intent")
    private val events = mutableListOf<String>()
    private val hook = object : SignOutHook {
        override suspend fun beforeSignOut() {
            events += "before"
        }

        override suspend fun onSessionEnded() {
            events += "ended"
        }
    }

    private val signInAttestation: SignInAttestation = mockk(relaxed = true)

    private fun repository(hooks: Set<SignOutHook> = emptySet()) =
        OidcAuthRepository(authorizer, deviceAuthorizer, revoker, tokenStore, logger, signInAttestation, hooks)

    private val tokens = OidcTokens("access", "refresh", accessExpiresAtEpochSeconds = 1_900L, subject = "user-1")

    @Test
    fun `beginSignIn hands the prepared launch to the caller`() = runTest {
        val launch = AuthorizationLaunch("intent")
        authorizer.launch = launch

        val result = repository().beginSignIn()

        assertSame(launch, (result as BeginSignInResult.Ready).launch)
    }

    @Test
    fun `beginSignIn reports NotConfigured without touching the network`() = runTest {
        authorizer.isConfigured = false
        authorizer.createError = AssertionError("must not be called")

        assertEquals(BeginSignInResult.NotConfigured, repository().beginSignIn())
    }

    @Test
    fun `beginSignIn reports NoBrowser when no browser can handle the request`() = runTest {
        authorizer.launch = null

        assertEquals(BeginSignInResult.NoBrowser, repository().beginSignIn())
    }

    @Test
    fun `beginSignIn propagates discovery failures as AedstError`() = runTest {
        authorizer.createError = AedstError.Offline()

        val thrown = runCatching { repository().beginSignIn() }.exceptionOrNull()

        assertTrue(thrown is AedstError.Offline)
    }

    @Test
    fun `completeSignIn stores the session built from the token response`() = runTest {
        authorizer.redeemResult = tokens

        val result = repository().completeSignIn(callback)

        val expected = AuthSession("user-1", "access", "refresh", accessExpiresAtEpochSeconds = 1_900L)
        assertEquals(SignInResult.SignedIn(expected), result)
        assertEquals(expected, tokenStore.session.value)
        assertEquals("access", tokenStore.currentAccessToken())
        assertSame(callback, authorizer.redeemed.single())
    }

    @Test
    fun `completeSignIn is Cancelled and stores nothing when the user backed out`() = runTest {
        authorizer.redeemResult = null

        assertEquals(SignInResult.Cancelled, repository().completeSignIn(callback))
        assertNull(tokenStore.session.value)
    }

    @Test
    fun `completeSignIn rejects a response without a refresh token and stores nothing`() = runTest {
        authorizer.redeemResult = tokens.copy(refreshToken = null)

        val thrown = runCatching { repository().completeSignIn(callback) }.exceptionOrNull()

        assertTrue(thrown is AedstError.Unknown)
        assertNull(tokenStore.session.value)
    }

    @Test
    fun `completeSignIn rejects a response without a subject`() = runTest {
        authorizer.redeemResult = tokens.copy(subject = null)

        val thrown = runCatching { repository().completeSignIn(callback) }.exceptionOrNull()

        assertTrue(thrown is AedstError.Unknown)
        assertNull(tokenStore.session.value)
    }

    @Test
    fun `completeSignIn propagates a mapped error and stores nothing`() = runTest {
        authorizer.redeemError = AedstError.Forbidden()

        val thrown = runCatching { repository().completeSignIn(callback) }.exceptionOrNull()

        assertTrue(thrown is AedstError.Forbidden)
        assertNull(tokenStore.session.value)
    }

    @Test
    fun `logout runs hooks first, revokes the refresh token and clears the local session`() = runTest {
        tokenStore.save(AuthSession("u1", "access", "refresh", 123L))
        revokeAction = { token ->
            events += "revoke:$token"
        }

        repository(setOf(hook)).logout()

        assertEquals(listOf("before", "revoke:refresh", "ended"), events)
        assertNull(tokenStore.session.value)
    }

    @Test
    fun `logout clears the local session even if revocation fails`() = runTest {
        tokenStore.save(AuthSession("u1", "access", "refresh", 123L))
        revokeAction = { throw IOException("boom") }

        repository().logout()

        assertNull(tokenStore.session.value)
    }

    @Test
    fun `logout does not wait forever for an unreachable IdP`() = runTest {
        tokenStore.save(AuthSession("u1", "access", "refresh", 123L))
        val never = CompletableDeferred<Unit>()
        revokeAction = { never.await() }

        repository().logout() // virtual time: the 5 s bound elapses instantly

        assertNull(tokenStore.session.value)
    }

    @Test
    fun `a failing sign-out hook does not block sign-out`() = runTest {
        tokenStore.save(AuthSession("u1", "access", "refresh", 123L))

        val failing = object : SignOutHook {
            override suspend fun beforeSignOut() = throw IllegalStateException("hook failed")

            override suspend fun onSessionEnded() = throw IllegalStateException("hook failed")
        }

        repository(setOf(failing, hook)).logout()

        assertEquals(listOf("refresh"), revoked)
        assertEquals(listOf("before", "ended"), events.filter { it == "before" || it == "ended" })
        assertNull(tokenStore.session.value)
    }

    @Test
    fun `logout without a session makes no revocation call`() = runTest {
        repository().logout()

        assertTrue(revoked.isEmpty())
    }

    @Test
    fun `device sign-in stores the session through the same path as the browser flow`() = runTest {
        deviceAuthorizer.pollResult = DeviceTokenResult.Tokens(tokens)
        val repository = repository()

        val authorization = repository.beginDeviceSignIn()
        val result = repository.awaitDeviceSignIn(authorization)

        val expected = AuthSession("user-1", "access", "refresh", accessExpiresAtEpochSeconds = 1_900L)
        assertEquals(DeviceSignInResult.SignedIn(expected), result)
        assertEquals(expected, tokenStore.session.value)
    }

    @Test
    fun `device sign-in requires a refresh token and stores nothing without one`() = runTest {
        deviceAuthorizer.pollResult = DeviceTokenResult.Tokens(tokens.copy(refreshToken = null))
        val repository = repository()

        val thrown = runCatching { repository.awaitDeviceSignIn(repository.beginDeviceSignIn()) }.exceptionOrNull()

        assertTrue(thrown is AedstError.Unknown)
        assertNull(tokenStore.session.value)
    }

    @Test
    fun `device sign-in denied and expired store nothing`() = runTest {
        val repository = repository()
        deviceAuthorizer.pollResult = DeviceTokenResult.Denied
        assertEquals(DeviceSignInResult.Denied, repository.awaitDeviceSignIn(deviceAuthorizer.authorization))
        deviceAuthorizer.pollResult = DeviceTokenResult.Expired
        assertEquals(DeviceSignInResult.Expired, repository.awaitDeviceSignIn(deviceAuthorizer.authorization))
        assertNull(tokenStore.session.value)
    }

    @Test
    fun `beginDeviceSignIn fails when the build is not configured`() = runTest {
        deviceAuthorizer.isConfigured = false

        assertTrue(runCatching { repository().beginDeviceSignIn() }.exceptionOrNull() is AedstError.Unknown)
    }
}
