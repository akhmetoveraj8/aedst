package com.aedst.core.network

import com.connectrpc.Interceptor
import com.connectrpc.StreamFunction
import com.connectrpc.UnaryFunction
import com.connectrpc.http.clone
import javax.inject.Inject

/**
 * Supplies the current access token; implemented in feature/auth's data layer. Read synchronously, never blocking.
 */
fun interface AuthTokenProvider {
    fun currentAccessToken(): String?
}

/**
 * Attaches the bearer token to every outgoing unary call — the Kotlin
 * analogue of `ConnectClientFactory.AuthInterceptor` on Apple. Registered in
 * [NetworkModule]. This interceptor only ever reads: an expired token is
 * handled reactively by [TokenRefreshAuthenticator] (refresh + replay on 401).
 */
class AuthInterceptor @Inject constructor(private val tokenProvider: AuthTokenProvider) : Interceptor {
    override fun unaryFunction(): UnaryFunction = UnaryFunction(
        requestFunction = { request ->
            val token = tokenProvider.currentAccessToken()
            if (token.isNullOrBlank()) {
                request
            } else {
                request.clone(headers = request.headers + mapOf("Authorization" to listOf("Bearer $token")))
            }
        },
    )

    override fun streamFunction(): StreamFunction = StreamFunction()
}
