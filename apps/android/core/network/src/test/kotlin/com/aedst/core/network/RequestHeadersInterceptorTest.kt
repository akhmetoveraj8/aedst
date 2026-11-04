package com.aedst.core.network

import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNotEquals
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Test
import java.util.Optional

class RequestHeadersInterceptorTest {

    private lateinit var server: MockWebServer
    private val client = OkHttpClient.Builder().addInterceptor(RequestHeadersInterceptor(Optional.empty())).build()

    @BeforeEach
    fun setUp() {
        server = MockWebServer().apply { start() }
    }

    @AfterEach
    fun tearDown() {
        server.shutdown()
    }

    private fun send() {
        server.enqueue(MockResponse().setResponseCode(200))
        client.newCall(Request.Builder().url(server.url("/")).build()).execute().close()
    }

    @Test
    fun `identifies the client as android with the app version`() {
        send()

        val header = server.takeRequest().getHeader(RequestHeadersInterceptor.CLIENT_HEADER)
        assertEquals("android/${BuildConfig.CLIENT_VERSION}", header)
        assertTrue(header!!.matches(Regex("android/\\d+\\.\\d+\\.\\d+.*")))
    }

    @Test
    fun `sends a valid W3C traceparent that changes per request`() {
        send()
        send()

        val first = server.takeRequest().getHeader(RequestHeadersInterceptor.TRACEPARENT_HEADER)!!
        val second = server.takeRequest().getHeader(RequestHeadersInterceptor.TRACEPARENT_HEADER)!!

        val format = Regex("00-[0-9a-f]{32}-[0-9a-f]{16}-01")
        assertTrue(format.matches(first), first)
        assertTrue(format.matches(second), second)
        assertNotEquals(first, second)
    }
}
