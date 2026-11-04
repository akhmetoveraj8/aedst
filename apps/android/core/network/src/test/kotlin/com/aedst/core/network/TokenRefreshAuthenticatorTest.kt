package com.aedst.core.network

import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Test

class TokenRefreshAuthenticatorTest {

    private lateinit var server: MockWebServer
    private val refreshCalls = mutableListOf<String?>()
    private var refreshResult: String? = "fresh-token"

    private val refresher = TokenRefresher { stale ->
        refreshCalls += stale
        refreshResult
    }
    private val client = OkHttpClient.Builder()
        .authenticator(TokenRefreshAuthenticator(dagger.Lazy { refresher }))
        .build()

    @BeforeEach
    fun setUp() {
        server = MockWebServer().apply { start() }
    }

    @AfterEach
    fun tearDown() {
        server.shutdown()
    }

    private fun call(path: String, token: String = "stale-token") = client.newCall(
        Request.Builder()
            .url(server.url(path))
            .header("Authorization", "Bearer $token")
            .post(ByteArray(0).toRequestBody())
            .build(),
    ).execute()

    @Test
    fun `401 triggers one refresh and replays the request with the new token`() {
        server.enqueue(MockResponse().setResponseCode(401))
        server.enqueue(MockResponse().setResponseCode(200))

        val response = call("/aedst.tasks.v1.TaskService/ListTasks")

        assertEquals(200, response.code)
        assertEquals(listOf<String?>("stale-token"), refreshCalls)
        assertEquals("Bearer stale-token", server.takeRequest().getHeader("Authorization"))
        assertEquals("Bearer fresh-token", server.takeRequest().getHeader("Authorization"))
    }

    @Test
    fun `surfaces the 401 when no fresh token is available`() {
        refreshResult = null
        server.enqueue(MockResponse().setResponseCode(401))

        val response = call("/aedst.tasks.v1.TaskService/ListTasks")

        assertEquals(401, response.code)
        assertEquals(1, server.requestCount)
    }

    @Test
    fun `retries at most once when the refreshed token is also rejected`() {
        server.enqueue(MockResponse().setResponseCode(401))
        server.enqueue(MockResponse().setResponseCode(401))
        server.enqueue(MockResponse().setResponseCode(200)) // must never be reached

        val response = call("/aedst.tasks.v1.TaskService/ListTasks")

        assertEquals(401, response.code)
        assertEquals(2, server.requestCount)
        assertEquals(1, refreshCalls.size)
    }

    @Test
    fun `passes a null stale token through when the request carried none`() {
        server.enqueue(MockResponse().setResponseCode(401))
        server.enqueue(MockResponse().setResponseCode(200))

        val request = Request.Builder()
            .url(server.url("/aedst.tasks.v1.TaskService/ListTasks"))
            .post(ByteArray(0).toRequestBody())
            .build()
        assertEquals(200, client.newCall(request).execute().code)

        assertNull(refreshCalls.single())
    }
}
