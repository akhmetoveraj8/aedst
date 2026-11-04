package com.aedst.feature.auth.data.oidc

import androidx.core.net.toUri
import com.aedst.core.common.AedstError
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import net.openid.appauth.AuthorizationServiceConfiguration
import javax.inject.Inject
import javax.inject.Singleton
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException

/**
 * Fetches `<issuer>/.well-known/openid-configuration` once per process and caches it (AppAuth's callback API wrapped
 * in a suspend function). A failed fetch is not cached, so the next attempt retries.
 *
 * The document's `issuer` must equal the configured issuer (OIDC Discovery 4.3): a mismatch is rejected before any
 * endpoint from it is used.
 */
@Singleton
class OidcDiscovery @Inject constructor(private val config: OidcConfig) :
    RevocationEndpointSource,
    DeviceEndpointSource {
    private val mutex = Mutex()

    @Volatile
    private var cached: AuthorizationServiceConfiguration? = null

    suspend fun configuration(): AuthorizationServiceConfiguration {
        cached?.let { return it }
        return mutex.withLock {
            cached ?: fetch().also { cached = it }
        }
    }

    /** `revocation_endpoint` (RFC 8414 / ZITADEL `/oauth/v2/revoke`), or null if the IdP does not advertise one. */
    override suspend fun revocationEndpoint(): String? =
        configuration().discoveryDoc?.docJson?.optString(REVOCATION_ENDPOINT_KEY)?.takeIf(String::isNotBlank)

    /** RFC 8628 `device_authorization_endpoint` — not modelled by AppAuth, so read from the raw document. */
    override suspend fun deviceAuthorizationEndpoint(): String? =
        configuration().discoveryDoc?.docJson?.optString(DEVICE_ENDPOINT_KEY)?.takeIf(String::isNotBlank)

    override suspend fun tokenEndpoint(): String? = configuration().tokenEndpoint.toString().takeIf(String::isNotBlank)

    private suspend fun fetch(): AuthorizationServiceConfiguration {
        val fetched = suspendCancellableCoroutine { continuation ->
            AuthorizationServiceConfiguration.fetchFromIssuer(
                config.normalizedIssuer.toUri(),
                { configuration, exception ->
                    if (configuration != null) {
                        continuation.resume(configuration)
                    } else {
                        continuation.resumeWithException(
                            exception?.toSignInError() ?: AedstError.Unknown("Discovery failed"),
                        )
                    }
                },
                OidcConnectionBuilder(config.allowCleartextIssuer),
            )
        }
        val documentIssuer = fetched.discoveryDoc?.issuer?.trimEnd('/')
        if (documentIssuer != config.normalizedIssuer) {
            throw AedstError.Unknown("Discovery document issuer does not match the configured issuer")
        }
        return fetched
    }

    private companion object {
        const val REVOCATION_ENDPOINT_KEY = "revocation_endpoint"
        const val DEVICE_ENDPOINT_KEY = "device_authorization_endpoint"
    }
}

/** Endpoints of the device flow; separate so [OkHttpDeviceAuthorizer] is testable without AppAuth. */
interface DeviceEndpointSource {
    suspend fun deviceAuthorizationEndpoint(): String?

    suspend fun tokenEndpoint(): String?
}

/** Where RFC 7009 revocation requests go; separate so [OkHttpTokenRevoker] is testable without AppAuth. */
fun interface RevocationEndpointSource {
    suspend fun revocationEndpoint(): String?
}
