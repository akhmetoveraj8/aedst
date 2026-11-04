package com.aedst.feature.auth.data.oidc

import com.aedst.core.common.AedstError
import com.aedst.feature.auth.domain.model.DeviceAuthorization
import com.aedst.feature.auth.domain.model.DeviceTokenResult
import com.aedst.feature.auth.testing.fakeJwt
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.advanceTimeBy
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.currentTime
import kotlinx.coroutines.test.runTest
import okhttp3.OkHttpClient
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import java.time.Clock
import java.time.Instant
import java.time.ZoneOffset

class OkHttpDeviceAuthorizerTest {

    private val server = MockWebServer()
    private val config = OidcConfig("https://auth.example.com", "tv-client", "proj-1", "com.aedst.android.tv")
    private val clock = Clock.fixed(Instant.ofEpochSecond(1_000), ZoneOffset.UTC)

    @AfterEach
    fun tearDown() {
        server.shutdown()
    }

    private fun endpoints(device: String? = server.url("/device").toString()) = object : DeviceEndpointSource {
        override suspend fun deviceAuthorizationEndpoint(): String? = device
        override suspend fun tokenEndpoint(): String? = server.url("/token").toString()
    }

    private fun authorizer(device: String? = server.url("/device").toString()) =
        OkHttpDeviceAuthorizer(OkHttpClient(), config, endpoints(device), clock)

    private fun authorization(expiresIn: Long = 300, interval: Long = 5) =
        DeviceAuthorization("WDJB-MJHT", "https://auth.example.com/device", null, expiresIn, interval, "dev-code")

    private fun json(body: String, code: Int = 200) = MockResponse().setResponseCode(code).setBody(body)

    private fun error(name: String, code: Int = 400) = json("""{"error":"$name"}""", code)

    private fun success() = json(
        """{"access_token":"${fakeJwt()}","id_token":"${fakeJwt()}","refresh_token":"r1","expires_in":3600}""",
    )

    @Test
    fun `start posts client id and scopes and parses the response`() = runTest {
        server.enqueue(
            json(
                """{"device_code":"dc","user_code":"ABCD-EFGH",""" +
                    """"verification_uri":"https://auth.example.com/device",""" +
                    """"verification_uri_complete":"https://auth.example.com/device?user_code=ABCD-EFGH",""" +
                    """"expires_in":600,"interval":7}""",
            ),
        )

        val result = authorizer().start()

        assertEquals("ABCD-EFGH", result.userCode)
        assertEquals("dc", result.deviceCode)
        assertEquals("https://auth.example.com/device?user_code=ABCD-EFGH", result.verificationUriComplete)
        assertEquals(600, result.expiresInSeconds)
        assertEquals(7, result.intervalSeconds)
        val request = server.takeRequest()
        assertEquals("POST", request.method)
        val body = request.body.readUtf8()
        assertTrue(body.contains("client_id=tv-client"))
        assertTrue(
            body.contains(
                "scope=openid+profile+email+offline_access+urn%3Azitadel%3Aiam%3Aorg%3Aproject%3Aid%3Aproj-1%3Aaud",
            ),
        )
        assertNull(request.getHeader("Authorization"))
    }

    @Test
    fun `start defaults the interval to 5 seconds and omits the complete uri`() = runTest {
        server.enqueue(json("""{"device_code":"dc","user_code":"U","verification_uri":"https://x/d"}"""))

        val result = authorizer().start()

        assertEquals(5, result.intervalSeconds)
        assertNull(result.verificationUriComplete)
    }

    @Test
    fun `start fails clearly when the IdP has no device endpoint`() = runTest {
        val thrown = runCatching { authorizer(device = null).start() }.exceptionOrNull()

        assertTrue(thrown is AedstError.Unknown)
        assertEquals(0, server.requestCount)
    }

    @Test
    fun `start reports a rejected grant as a configuration problem`() = runTest {
        server.enqueue(error("unauthorized_client"))

        assertTrue(runCatching { authorizer().start() }.exceptionOrNull() is AedstError.Unknown)
    }

    @Test
    fun `pending then slow_down then success follows the interval and adds 5 seconds`() = runTest {
        server.enqueue(error("authorization_pending"))
        server.enqueue(error("slow_down"))
        server.enqueue(success())

        val result = authorizer().poll(authorization(interval = 5))

        // waits: 5 s (pending), 5 s (slow_down), then 10 s (interval 5 + 5).
        assertEquals(20_000L, currentTime)
        val tokens = (result as DeviceTokenResult.Tokens).tokens
        assertEquals("r1", tokens.refreshToken)
        assertEquals("u1", tokens.subject)
        assertEquals(1_000L + 3_600L, tokens.accessExpiresAtEpochSeconds)
        val body = server.takeRequest().body.readUtf8()
        assertTrue(body.contains("grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Adevice_code"))
        assertTrue(body.contains("device_code=dev-code"))
        assertTrue(body.contains("client_id=tv-client"))
    }

    @Test
    fun `access_denied ends the flow as Denied`() = runTest {
        server.enqueue(error("access_denied"))

        assertEquals(DeviceTokenResult.Denied, authorizer().poll(authorization()))
    }

    @Test
    fun `expired_token ends the flow as Expired`() = runTest {
        server.enqueue(error("authorization_pending"))
        server.enqueue(error("expired_token"))

        assertEquals(DeviceTokenResult.Expired, authorizer().poll(authorization()))
    }

    @Test
    fun `the local deadline expires the flow without polling past it`() = runTest {
        repeat(5) { server.enqueue(error("authorization_pending")) }

        val result = authorizer().poll(authorization(expiresIn = 12, interval = 5))

        assertEquals(DeviceTokenResult.Expired, result)
        assertEquals(2, server.requestCount) // polls at 5 s and 10 s; the 15 s wait is past the 12 s lifetime
    }

    @Test
    fun `a transient server error is retried with a longer wait`() = runTest {
        server.enqueue(json("", 503))
        server.enqueue(success())

        val result = authorizer().poll(authorization(interval = 5))

        assertTrue(result is DeviceTokenResult.Tokens)
        // 5 s, then 5 s doubled once = 10 s.
        assertEquals(15_000L, currentTime)
    }

    @Test
    fun `persistent failures give up with an error`() = runTest {
        repeat(10) { server.enqueue(json("", 503)) }

        val thrown = runCatching { authorizer().poll(authorization(expiresIn = 100_000)) }.exceptionOrNull()

        assertTrue(thrown is AedstError.Unavailable)
        assertEquals(7, server.requestCount) // 1 + 6 tolerated failures
    }

    @Test
    fun `a grant that is not enabled for the client is not retried`() = runTest {
        server.enqueue(error("unsupported_grant_type"))

        val thrown = runCatching { authorizer().poll(authorization()) }.exceptionOrNull()

        assertTrue(thrown is AedstError.Unknown)
        assertEquals(1, server.requestCount)
    }

    @Test
    fun `an opaque access token is rejected like in the browser flow`() = runTest {
        server.enqueue(json("""{"access_token":"opaque","refresh_token":"r","expires_in":60}"""))

        val thrown = runCatching { authorizer().poll(authorization()) }.exceptionOrNull()

        assertTrue(thrown is AedstError.Unknown)
    }

    @Test
    fun `cancelling while waiting sends nothing`() = runTest {
        val job = launch { authorizer().poll(authorization(interval = 5)) }

        advanceTimeBy(1_000)
        job.cancel()
        advanceUntilIdle()

        assertTrue(job.isCancelled)
        assertEquals(0, server.requestCount)
    }
}
