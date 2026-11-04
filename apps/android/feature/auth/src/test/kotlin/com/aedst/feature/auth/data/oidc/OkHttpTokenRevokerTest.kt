package com.aedst.feature.auth.data.oidc

import com.aedst.core.common.AedstError
import kotlinx.coroutines.test.runTest
import okhttp3.OkHttpClient
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

class OkHttpTokenRevokerTest {

    private val server = MockWebServer()
    private val config = OidcConfig("https://auth.example.com", "client-1", "", "com.aedst.android")

    @AfterEach
    fun tearDown() {
        server.shutdown()
    }

    private fun revoker(endpoint: String? = server.url("/oauth/v2/revoke").toString()) =
        OkHttpTokenRevoker(OkHttpClient(), config, RevocationEndpointSource { endpoint })

    @Test
    fun `posts the refresh token and the public client id as a form`() = runTest {
        server.enqueue(MockResponse().setResponseCode(200))

        revoker().revoke("secret-refresh")

        val request = server.takeRequest()
        assertEquals("POST", request.method)
        assertEquals("/oauth/v2/revoke", request.path)
        val body = request.body.readUtf8()
        assertTrue(body.contains("token=secret-refresh"))
        assertTrue(body.contains("token_type_hint=refresh_token"))
        assertTrue(body.contains("client_id=client-1"))
        assertNull(request.getHeader("Authorization"))
    }

    @Test
    fun `a non-success status is reported so the caller can log it`() = runTest {
        server.enqueue(MockResponse().setResponseCode(503))

        val thrown = runCatching { revoker().revoke("r") }.exceptionOrNull()

        assertTrue(thrown is AedstError.Unavailable)
    }

    @Test
    fun `an IdP without a revocation endpoint is a no-op`() = runTest {
        revoker(endpoint = null).revoke("r")

        assertEquals(0, server.requestCount)
    }
}
