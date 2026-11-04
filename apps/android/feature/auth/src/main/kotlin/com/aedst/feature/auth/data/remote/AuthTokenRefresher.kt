package com.aedst.feature.auth.data.remote

import com.aedst.core.common.AedstError
import com.aedst.core.common.Logger
import com.aedst.core.common.SignOutHook
import com.aedst.core.network.TokenRefresher
import com.aedst.core.network.toAedstError
import com.aedst.feature.auth.data.local.AuthTokenStore
import com.aedst.feature.auth.domain.repository.OidcAuthorizer
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import java.io.IOException
import javax.inject.Inject
import javax.inject.Provider
import javax.inject.Singleton

/**
 * Implements `core/network`'s [TokenRefresher]: exchanges the stored refresh token for new tokens at the IdP's token
 * endpoint (OIDC `refresh_token` grant) when a request came back 401.
 *
 * - **Single-flight**: a mutex serializes callers; the second caller finds the token already replaced
 *   (`current.accessToken != stale`) and reuses it instead of burning the (rotating) refresh token twice. ZITADEL
 *   rotates refresh tokens, so the new one returned by the IdP is stored together with the new access token.
 * - **Definitive rejection** (`invalid_grant`: refresh token expired, revoked or already used) clears the session,
 *   which flips `SessionState` and sends the user back to sign-in; the hooks' `onSessionEnded` then wipe the local
 *   data of that user (outbox, caches), exactly as an explicit sign-out does.
 * - **Transient failure** (offline, 5xx, timeout, discovery failure, clock-skewed ID token) keeps the session and
 *   throws [IOException], so the request fails as a retryable network error, the user stays signed in and the next
 *   request tries again.
 *
 * Known window: if the process dies after the IdP rotated the token but before [AuthTokenStore.save] completed, the
 * old refresh token is gone and the next refresh is `invalid_grant` — the user signs in again.
 */
@Singleton
class AuthTokenRefresher @Inject constructor(
    private val tokenStore: AuthTokenStore,
    private val authorizer: OidcAuthorizer,
    private val logger: Logger,
    // A Provider: the hooks reach back into the HTTP stack (push unregister), which contains this refresher.
    private val signOutHooks: Provider<Set<@JvmSuppressWildcards SignOutHook>> = Provider { emptySet() },
) : TokenRefresher {
    private val mutex = Mutex()

    override fun refresh(staleAccessToken: String?): String? =
        runBlocking { mutex.withLock { refreshLocked(staleAccessToken) } }

    private suspend fun refreshLocked(staleAccessToken: String?): String? {
        val current = tokenStore.awaitSession() ?: return null
        if (staleAccessToken != null && current.accessToken != staleAccessToken) return current.accessToken

        val tokens = try {
            authorizer.refresh(current.refreshToken)
        } catch (cancellation: CancellationException) {
            throw cancellation
        } catch (@Suppress("TooGenericExceptionCaught") throwable: Throwable) {
            val error = throwable.toAedstError()
            if (error is AedstError.Unauthenticated) {
                logger.warn(TAG, "Refresh token rejected; ending session", error)
                tokenStore.clear()
                signOutHooks.get().runEach(logger, TAG) { it.onSessionEnded() }
            } else {
                logger.warn(TAG, "Token refresh failed transiently", error)
                // Surfaces as a retryable network error (OkHttp propagates it), not as the original 401, so a queued
                // outbox item is retried instead of being parked as unauthenticated (session-refresh.json).
                throw IOException("Token refresh failed transiently", throwable)
            }
            return null
        }

        val refreshed = current.copy(
            accessToken = tokens.accessToken,
            refreshToken = tokens.refreshToken ?: current.refreshToken,
            accessExpiresAtEpochSeconds = tokens.accessExpiresAtEpochSeconds,
        )
        tokenStore.save(refreshed)
        return refreshed.accessToken
    }

    private companion object {
        const val TAG = "AuthTokenRefresher"
    }
}
