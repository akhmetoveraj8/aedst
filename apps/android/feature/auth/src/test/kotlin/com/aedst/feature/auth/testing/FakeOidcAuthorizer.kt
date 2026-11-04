package com.aedst.feature.auth.testing

import com.aedst.feature.auth.domain.model.AuthorizationCallback
import com.aedst.feature.auth.domain.model.AuthorizationLaunch
import com.aedst.feature.auth.domain.model.OidcTokens
import com.aedst.feature.auth.domain.repository.OidcAuthorizer
import java.util.Base64
import java.util.concurrent.atomic.AtomicInteger

/** Scriptable [OidcAuthorizer]: no AppAuth, no Android, no network. */
class FakeOidcAuthorizer : OidcAuthorizer {
    override var isConfigured: Boolean = true
    var launch: AuthorizationLaunch? = AuthorizationLaunch("browser-intent")
    var createError: Throwable? = null

    var redeemResult: OidcTokens? = null
    var redeemError: Throwable? = null
    val redeemed = mutableListOf<AuthorizationCallback>()

    var refreshResult: OidcTokens = OidcTokens("new-access", "new-refresh", 5_900L, "u1")
    var refreshError: Throwable? = null
    var refreshDelayMillis: Long = 0
    val refreshedWith = mutableListOf<String>()
    private val refreshCounter = AtomicInteger()
    val refreshCalls: Int get() = refreshCounter.get()

    override suspend fun createAuthorization(): AuthorizationLaunch? {
        createError?.let { throw it }
        return launch
    }

    override suspend fun redeem(callback: AuthorizationCallback): OidcTokens? {
        redeemed += callback
        redeemError?.let { throw it }
        return redeemResult
    }

    override suspend fun refresh(refreshToken: String): OidcTokens {
        refreshCounter.incrementAndGet()
        synchronized(refreshedWith) { refreshedWith += refreshToken }
        if (refreshDelayMillis > 0) Thread.sleep(refreshDelayMillis) // widens race windows in concurrency tests
        refreshError?.let { throw it }
        return refreshResult
    }
}

/** An unsigned JWT-shaped string with the given JSON payload (the client never verifies signatures). */
fun fakeJwt(payloadJson: String = """{"sub":"u1"}"""): String {
    val encoder = Base64.getUrlEncoder().withoutPadding()
    fun part(json: String) = encoder.encodeToString(json.toByteArray())
    return "${part("""{"alg":"RS256"}""")}.${part(payloadJson)}.signature"
}
