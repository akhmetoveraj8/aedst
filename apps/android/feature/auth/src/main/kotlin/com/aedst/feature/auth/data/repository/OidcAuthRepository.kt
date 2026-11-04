package com.aedst.feature.auth.data.repository

import com.aedst.core.common.AedstError
import com.aedst.core.common.Logger
import com.aedst.core.common.SignOutHook
import com.aedst.feature.auth.data.attestation.SignInAttestation
import com.aedst.feature.auth.data.local.AuthTokenStore
import com.aedst.feature.auth.data.remote.runEach
import com.aedst.feature.auth.domain.model.AuthSession
import com.aedst.feature.auth.domain.model.AuthorizationCallback
import com.aedst.feature.auth.domain.model.BeginSignInResult
import com.aedst.feature.auth.domain.model.DeviceAuthorization
import com.aedst.feature.auth.domain.model.DeviceSignInResult
import com.aedst.feature.auth.domain.model.DeviceTokenResult
import com.aedst.feature.auth.domain.model.OidcTokens
import com.aedst.feature.auth.domain.model.SignInResult
import com.aedst.feature.auth.domain.repository.AuthRepository
import com.aedst.feature.auth.domain.repository.DeviceAuthorizer
import com.aedst.feature.auth.domain.repository.OidcAuthorizer
import com.aedst.feature.auth.domain.repository.TokenRevoker
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeoutOrNull
import javax.inject.Inject

internal class OidcAuthRepository @Inject constructor(
    private val authorizer: OidcAuthorizer,
    private val deviceAuthorizer: DeviceAuthorizer,
    private val tokenRevoker: TokenRevoker,
    private val tokenStore: AuthTokenStore,
    private val logger: Logger,
    private val signInAttestation: SignInAttestation,
    private val signOutHooks: Set<@JvmSuppressWildcards SignOutHook> = emptySet(),
) : AuthRepository {

    override val session: Flow<AuthSession?> = tokenStore.session

    override val isSignInConfigured: Boolean get() = authorizer.isConfigured

    override suspend fun beginSignIn(): BeginSignInResult {
        if (!authorizer.isConfigured) return BeginSignInResult.NotConfigured
        val launch = authorizer.createAuthorization() ?: return BeginSignInResult.NoBrowser
        return BeginSignInResult.Ready(launch)
    }

    override suspend fun completeSignIn(callback: AuthorizationCallback): SignInResult {
        val tokens = authorizer.redeem(callback) ?: return SignInResult.Cancelled
        return SignInResult.SignedIn(saveSession(tokens))
    }

    override suspend fun beginDeviceSignIn(): DeviceAuthorization {
        if (!deviceAuthorizer.isConfigured) throw AedstError.Unknown("Sign-in is not configured in this build")
        return deviceAuthorizer.start()
    }

    override suspend fun awaitDeviceSignIn(authorization: DeviceAuthorization): DeviceSignInResult =
        when (val result = deviceAuthorizer.poll(authorization)) {
            is DeviceTokenResult.Tokens -> DeviceSignInResult.SignedIn(saveSession(result.tokens))
            DeviceTokenResult.Denied -> DeviceSignInResult.Denied
            DeviceTokenResult.Expired -> DeviceSignInResult.Expired
        }

    /** Shared by both sign-in paths: requires a refresh token and a subject, then persists the session. */
    private suspend fun saveSession(tokens: OidcTokens): AuthSession {
        val refreshToken = tokens.refreshToken
            ?: throw AedstError.Unknown(
                "The IdP issued no refresh token; enable the refresh_token grant and the offline_access scope",
            )
        val userId = tokens.subject ?: throw AedstError.Unknown("The IdP issued no subject (sub) claim")
        val session = AuthSession(
            userId = userId,
            accessToken = tokens.accessToken,
            refreshToken = refreshToken,
            accessExpiresAtEpochSeconds = tokens.accessExpiresAtEpochSeconds,
        )
        tokenStore.save(session)
        // Best effort and non-blocking: launched on the application scope, informational only, never throws.
        signInAttestation.onSignedIn()
        return session
    }

    override suspend fun logout() {
        // While the session is still valid: e.g. UnregisterPushDevice needs the bearer token. Best effort each.
        signOutHooks.runEach(logger, TAG) { it.beforeSignOut() }
        val refreshToken = tokenStore.awaitSession()?.refreshToken
        try {
            if (!refreshToken.isNullOrBlank()) {
                // Bounded: sign-out must not wait on an unreachable IdP. A timeout leaves the token to expire.
                withTimeoutOrNull(REVOKE_TIMEOUT_MS) { tokenRevoker.revoke(refreshToken) }
            }
        } catch (cancellation: CancellationException) {
            throw cancellation
        } catch (@Suppress("TooGenericExceptionCaught") failure: Throwable) {
            // Best effort: an unreachable IdP must not trap the user in a signed-in state. The local session is
            // cleared below regardless. Log the kind only — never the token.
            logger.warn(TAG, "Refresh token revocation failed", failure)
        } finally {
            // NonCancellable: sign-out must complete locally even if the caller is cancelled mid-request.
            withContext(NonCancellable) {
                tokenStore.clear()
                // Local data of the user who just left (queued writes, caches, counters).
                signOutHooks.runEach(logger, TAG) { it.onSessionEnded() }
            }
        }
    }

    private companion object {
        const val TAG = "AuthRepository"
        const val REVOKE_TIMEOUT_MS = 5_000L
    }
}
