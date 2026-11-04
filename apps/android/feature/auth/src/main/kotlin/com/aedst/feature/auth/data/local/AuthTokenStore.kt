package com.aedst.feature.auth.data.local

import com.aedst.core.common.ApplicationScope
import com.aedst.core.security.EncryptedPreferences
import com.aedst.feature.auth.domain.model.AuthSession
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import javax.inject.Inject
import javax.inject.Singleton

/**
 * The only place in the app that reads/writes auth tokens — everything
 * else (including `core/network`'s [com.aedst.core.network.AuthTokenProvider]
 * binding) goes through this. Backed by [EncryptedPreferences] (Keystore +
 * Tink), never plain SharedPreferences.
 *
 * The persisted session is restored asynchronously on construction; until
 * that completes [session] is null (and [currentAccessToken] returns null,
 * because the network interceptor needs a synchronous, non-blocking read).
 * [isRestored] flips to true afterwards so the app can hold its splash screen
 * instead of flashing the login form at a signed-in user. Writes wait for the
 * restore so they can never be clobbered by it.
 */
@Singleton
class AuthTokenStore @Inject constructor(
    private val encryptedPreferences: EncryptedPreferences,
    @ApplicationScope scope: CoroutineScope,
) {
    private val sessionState = MutableStateFlow<AuthSession?>(null)
    private val restoredState = MutableStateFlow(false)
    private val restored = CompletableDeferred<Unit>()
    val session: StateFlow<AuthSession?> = sessionState.asStateFlow()
    val isRestored: StateFlow<Boolean> = restoredState.asStateFlow()

    init {
        scope.launch {
            try {
                sessionState.value = restore(encryptedPreferences.getAll())
            } finally {
                restoredState.value = true
                restored.complete(Unit)
            }
        }
    }

    /** Suspends until the persisted session has been restored, then returns it. */
    suspend fun awaitSession(): AuthSession? {
        restored.await()
        return sessionState.value
    }

    suspend fun save(session: AuthSession) {
        restored.await()
        encryptedPreferences.putAll(
            mapOf(
                KEY_USER_ID to session.userId,
                KEY_ACCESS_TOKEN to session.accessToken,
                KEY_REFRESH_TOKEN to session.refreshToken,
                KEY_EXPIRES_AT to session.accessExpiresAtEpochSeconds.toString(),
            ),
        )
        sessionState.value = session
    }

    suspend fun clear() {
        restored.await()
        encryptedPreferences.remove(KEY_USER_ID, KEY_ACCESS_TOKEN, KEY_REFRESH_TOKEN, KEY_EXPIRES_AT)
        sessionState.value = null
    }

    fun currentAccessToken(): String? = sessionState.value?.accessToken

    private fun restore(entries: Map<String, String>): AuthSession? {
        val userId = entries[KEY_USER_ID] ?: return null
        val accessToken = entries[KEY_ACCESS_TOKEN] ?: return null
        val refreshToken = entries[KEY_REFRESH_TOKEN] ?: return null
        val expiresAt = entries[KEY_EXPIRES_AT]?.toLongOrNull() ?: return null
        return AuthSession(userId, accessToken, refreshToken, expiresAt)
    }

    private companion object {
        const val KEY_USER_ID = "auth.user_id"
        const val KEY_ACCESS_TOKEN = "auth.access_token"
        const val KEY_REFRESH_TOKEN = "auth.refresh_token"
        const val KEY_EXPIRES_AT = "auth.access_expires_at"
    }
}
