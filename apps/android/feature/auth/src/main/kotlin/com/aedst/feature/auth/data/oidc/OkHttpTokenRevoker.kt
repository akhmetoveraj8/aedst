package com.aedst.feature.auth.data.oidc

import com.aedst.core.common.AedstError
import com.aedst.core.network.ExternalHttpClient
import com.aedst.feature.auth.domain.repository.TokenRevoker
import okhttp3.FormBody
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.coroutines.executeAsync
import javax.inject.Inject

/**
 * RFC 7009 revocation of the refresh token at the IdP (ZITADEL: `POST /oauth/v2/revoke`, public client = `client_id`
 * in the form, no secret; revoking a refresh token also revokes the access token issued from it).
 *
 * Uses core/network's [ExternalHttpClient]: no bearer token, no first-party headers and no API certificate pinning
 * (the IdP is a different host). Callers bound the call with a timeout and ignore failures — sign-out must never be
 * held hostage by an unreachable IdP.
 */
class OkHttpTokenRevoker @Inject constructor(
    @ExternalHttpClient private val client: OkHttpClient,
    private val config: OidcConfig,
    private val endpointSource: RevocationEndpointSource,
) : TokenRevoker {

    override suspend fun revoke(refreshToken: String) {
        val endpoint = endpointSource.revocationEndpoint() ?: return // IdP advertises no revocation: nothing to do
        val request = Request.Builder()
            .url(endpoint)
            .post(
                FormBody.Builder()
                    .add("token", refreshToken)
                    .add("token_type_hint", "refresh_token")
                    .add("client_id", config.clientId)
                    .build(),
            )
            .build()
        // RFC 7009 section 2.2: 200 even for an unknown token; any non-2xx means the revoke did not happen.
        client.newCall(request).executeAsync().use { response ->
            if (!response.isSuccessful) throw AedstError.Unavailable("Token revocation failed: HTTP ${response.code}")
        }
    }
}
