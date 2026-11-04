package com.aedst.feature.auth.data.oidc

import com.aedst.core.common.AedstError
import com.aedst.core.network.ExternalHttpClient
import com.aedst.core.network.toAedstError
import com.aedst.feature.auth.domain.model.DeviceAuthorization
import com.aedst.feature.auth.domain.model.DeviceTokenResult
import com.aedst.feature.auth.domain.repository.DeviceAuthorizer
import kotlinx.coroutines.delay
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.longOrNull
import okhttp3.FormBody
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.coroutines.executeAsync
import java.io.IOException
import java.time.Clock
import javax.inject.Inject

/**
 * [DeviceAuthorizer] on OkHttp (core/network's [ExternalHttpClient]: no bearer token, no API pinning) — RFC 8628 for a
 * public client (`client_id` only). ZITADEL: `device_authorization_endpoint` from discovery, grant
 * `urn:ietf:params:oauth:grant-type:device_code`, enabled per application ("Device Code" grant type).
 *
 * The IdP's JSON is parsed with kotlinx.serialization's tree API (`JsonObject`, no `@Serializable` class, so no
 * reflection/R8 rules and plain-JVM tests), the same as `AccessTokenClaims`. These are OAuth protocol responses, not
 * API payloads (those stay protobuf).
 *
 * Time is accounted by the waits themselves (`delay`), not by the wall clock: the loop is deterministic under
 * virtual time and immune to the user changing the device clock mid-flow.
 */
class OkHttpDeviceAuthorizer @Inject constructor(
    @ExternalHttpClient private val client: OkHttpClient,
    private val config: OidcConfig,
    private val endpoints: DeviceEndpointSource,
    private val clock: Clock,
) : DeviceAuthorizer {

    override val isConfigured: Boolean get() = config.isConfigured

    override suspend fun start(): DeviceAuthorization {
        val endpoint = requireDeviceEndpoint()
        val request = Request.Builder()
            .url(endpoint)
            .post(
                FormBody.Builder()
                    .add("client_id", config.clientId)
                    .add("scope", config.scopes.joinToString(" "))
                    .build(),
            )
            .build()
        val (status, json) = try {
            execute(request)
        } catch (failure: IOException) {
            throw failure.toAedstError()
        }
        if (status !in HTTP_SUCCESS) throw startFailure(status, json)
        return parseAuthorization(json)
    }

    private suspend fun requireDeviceEndpoint() = endpoints.deviceAuthorizationEndpoint()
        ?: throw AedstError.Unknown("The IdP advertises no device_authorization_endpoint")

    private fun parseAuthorization(json: JsonObject?): DeviceAuthorization {
        val malformed = AedstError.Unavailable("Malformed device authorization response")
        val body = json ?: throw malformed
        val userCode = body.string("user_code")
        val deviceCode = body.string("device_code")
        val verificationUri = body.string("verification_uri")
        if (userCode == null || deviceCode == null || verificationUri == null) throw malformed
        return DeviceAuthorization(
            userCode = userCode,
            verificationUri = verificationUri,
            verificationUriComplete = body.string("verification_uri_complete"),
            expiresInSeconds = body.long("expires_in")?.takeIf { it > 0 } ?: DEFAULT_EXPIRES_IN_SECONDS,
            intervalSeconds = body.long("interval")?.takeIf { it > 0 } ?: DEFAULT_INTERVAL_SECONDS,
            deviceCode = deviceCode,
        )
    }

    override suspend fun poll(authorization: DeviceAuthorization): DeviceTokenResult {
        val tokenEndpoint =
            endpoints.tokenEndpoint() ?: throw AedstError.Unknown("The IdP advertises no token endpoint")
        var intervalSeconds = authorization.intervalSeconds.coerceAtLeast(1)
        var elapsedSeconds = 0L
        var consecutiveFailures = 0
        while (true) {
            // Transient failures stretch the wait exponentially (capped), on top of the server's interval.
            val waitSeconds = (intervalSeconds shl consecutiveFailures.coerceAtMost(MAX_BACKOFF_DOUBLINGS))
                .coerceAtMost(MAX_WAIT_SECONDS.coerceAtLeast(intervalSeconds))
            delay(waitSeconds * MILLIS_PER_SECOND)
            elapsedSeconds += waitSeconds
            if (elapsedSeconds > authorization.expiresInSeconds) return DeviceTokenResult.Expired

            when (val attempt = pollOnce(tokenEndpoint, authorization)) {
                is Attempt.Done -> return attempt.result
                Attempt.Pending -> consecutiveFailures = 0
                // RFC 8628 section 3.5: add 5 seconds to the interval for this and all later requests.
                Attempt.SlowDown -> {
                    consecutiveFailures = 0
                    intervalSeconds += SLOW_DOWN_STEP_SECONDS
                }
                is Attempt.Transient -> {
                    consecutiveFailures++
                    if (consecutiveFailures > MAX_CONSECUTIVE_FAILURES) throw attempt.error
                }
            }
        }
    }

    private suspend fun pollOnce(tokenEndpoint: String, authorization: DeviceAuthorization): Attempt {
        val request = Request.Builder()
            .url(tokenEndpoint)
            .post(
                FormBody.Builder()
                    .add("grant_type", DEVICE_CODE_GRANT)
                    .add("device_code", authorization.deviceCode)
                    .add("client_id", config.clientId)
                    .build(),
            )
            .build()
        val (status, json) = try {
            execute(request)
        } catch (failure: IOException) {
            return Attempt.Transient(failure.toAedstError())
        }
        if (status in HTTP_SUCCESS) {
            val tokens = oidcTokensFrom(
                accessToken = json?.string("access_token"),
                idToken = json?.string("id_token"),
                refreshToken = json?.string("refresh_token"),
                accessExpirationMillis = json?.long("expires_in")?.let { clock.millis() + it * MILLIS_PER_SECOND },
                clock = clock,
            )
            return Attempt.Done(DeviceTokenResult.Tokens(tokens))
        }
        return when (val error = json?.string("error")) {
            "authorization_pending" -> Attempt.Pending
            "slow_down" -> Attempt.SlowDown
            "access_denied" -> Attempt.Done(DeviceTokenResult.Denied)
            "expired_token" -> Attempt.Done(DeviceTokenResult.Expired)
            else -> when {
                status >= HTTP_SERVER_ERROR || status == HTTP_TOO_MANY_REQUESTS || error == null ->
                    Attempt.Transient(AedstError.Unavailable("Device token request failed: HTTP $status"))
                // invalid_client / unauthorized_client / unsupported_grant_type: the Device Code grant is not
                // enabled for this application at the IdP (a configuration problem, retrying cannot help).
                else -> throw AedstError.Unknown("Device token request rejected: $error")
            }
        }
    }

    private fun startFailure(status: Int, json: JsonObject?): AedstError {
        val error = json?.string("error")
        return when {
            status >= HTTP_SERVER_ERROR || status == HTTP_TOO_MANY_REQUESTS -> AedstError.Unavailable("HTTP $status")
            // The device grant is not enabled for the client, or scopes are invalid: configuration.
            else -> AedstError.Unknown("Device authorization rejected: ${error ?: "HTTP $status"}")
        }
    }

    private suspend fun execute(request: Request): Pair<Int, JsonObject?> =
        client.newCall(request).executeAsync().use { response ->
            response.code to parseObject(response.body.string())
        }

    private fun parseObject(body: String): JsonObject? =
        runCatching { Json.parseToJsonElement(body) as? JsonObject }.getOrNull()

    private fun JsonObject.string(key: String): String? =
        (get(key) as? JsonPrimitive)?.contentOrNull?.takeIf(String::isNotBlank)

    private fun JsonObject.long(key: String): Long? = (get(key) as? JsonPrimitive)?.longOrNull

    private sealed interface Attempt {
        data class Done(val result: DeviceTokenResult) : Attempt

        data object Pending : Attempt

        data object SlowDown : Attempt

        class Transient(val error: AedstError) : Attempt
    }

    companion object {
        const val DEVICE_CODE_GRANT = "urn:ietf:params:oauth:grant-type:device_code"
        private val HTTP_SUCCESS = 200..299
        private const val HTTP_SERVER_ERROR = 500
        private const val HTTP_TOO_MANY_REQUESTS = 429
        private const val DEFAULT_INTERVAL_SECONDS = 5L
        private const val DEFAULT_EXPIRES_IN_SECONDS = 300L
        private const val SLOW_DOWN_STEP_SECONDS = 5L
        private const val MAX_CONSECUTIVE_FAILURES = 6
        private const val MAX_BACKOFF_DOUBLINGS = 4
        private const val MAX_WAIT_SECONDS = 60L
        private const val MILLIS_PER_SECOND = 1000L
    }
}
