package com.aedst.core.security

import com.google.android.play.core.integrity.StandardIntegrityManager
import com.google.android.play.core.integrity.StandardIntegrityManager.PrepareIntegrityTokenRequest
import com.google.android.play.core.integrity.StandardIntegrityManager.StandardIntegrityTokenProvider
import com.google.android.play.core.integrity.StandardIntegrityManager.StandardIntegrityTokenRequest
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.tasks.await
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Thin wrapper over the Play Integrity **standard** API (warm-up once, then a cheap per-request token), which is the
 * recommended mode for frequent checks: the classic API allows far fewer calls and adds a round trip each time.
 *
 * Only useful together with server-side verdict decoding: the token is opaque to the app and must be sent to the
 * backend, which decodes it with Google's `decodeIntegrityToken` and checks the verdict and the `requestHash`
 * (`IntegrityService.VerifyIntegrityToken`, ADR-0002). feature/auth calls it best-effort after sign-in
 * (`PlayIntegrityDeviceAttestor`); the verdict is informational, nothing is enforced yet.
 */
interface IntegrityFacade {
    /**
     * [requestHash] binds the token to one request (hash of the request body/action, at most 500 bytes); the backend
     * must compare it with the hash it computes itself. Fails when no Google Cloud project number is configured.
     */
    suspend fun requestIntegrityToken(requestHash: String): Result<String>
}

@Singleton
class PlayIntegrityFacade @Inject constructor(
    private val integrityManager: StandardIntegrityManager,
    private val cloudProjectNumber: PlayIntegrityCloudProject,
) : IntegrityFacade {
    private val mutex = Mutex()
    private var provider: StandardIntegrityTokenProvider? = null

    override suspend fun requestIntegrityToken(requestHash: String): Result<String> = try {
        Result.success(fetchToken(requestHash))
    } catch (cancellation: CancellationException) {
        throw cancellation // never fold cancellation into a failed Result: callers must stop, not continue
    } catch (@Suppress("TooGenericExceptionCaught") failure: Exception) {
        Result.failure(failure)
    }

    private suspend fun fetchToken(requestHash: String): String {
        check(cloudProjectNumber.value > 0) { "Play Integrity cloud project number is not configured" }
        val tokenProvider = provider() ?: error("Play Integrity token provider unavailable")
        val request = StandardIntegrityTokenRequest.builder().setRequestHash(requestHash).build()
        return try {
            tokenProvider.request(request).await().token()
        } catch (cancellation: CancellationException) {
            throw cancellation
        } catch (@Suppress("TooGenericExceptionCaught") failure: Exception) {
            // An expired/invalidated provider (e.g. TOKEN_PROVIDER_INVALID) is re-prepared on the next call.
            mutex.withLock { provider = null }
            throw failure
        }
    }

    private suspend fun provider(): StandardIntegrityTokenProvider? = mutex.withLock {
        provider ?: integrityManager
            .prepareIntegrityToken(
                PrepareIntegrityTokenRequest.builder().setCloudProjectNumber(cloudProjectNumber.value).build(),
            )
            .await()
            .also { provider = it }
    }
}

/** Google Cloud project number linked to the app in Play Console; `0` when not configured (the facade then fails). */
data class PlayIntegrityCloudProject(val value: Long)
