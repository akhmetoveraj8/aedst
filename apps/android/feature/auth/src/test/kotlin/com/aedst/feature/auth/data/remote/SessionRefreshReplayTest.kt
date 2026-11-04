package com.aedst.feature.auth.data.remote

import com.aedst.core.common.AedstError
import com.aedst.core.common.Logger
import com.aedst.core.network.TokenRefreshAuthenticator
import com.aedst.core.testing.BehaviorFixture
import com.aedst.feature.auth.data.local.AuthTokenStore
import com.aedst.feature.auth.domain.model.AuthSession
import com.aedst.feature.auth.testing.FakeEncryptedPreferences
import com.aedst.feature.auth.testing.FakeOidcAuthorizer
import io.mockk.mockk
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.mockwebserver.Dispatcher
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import okhttp3.mockwebserver.RecordedRequest
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Test
import java.io.IOException
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.ConcurrentLinkedQueue
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger

/**
 * Replays docs/contract/behavior/session-refresh.json against the real [TokenRefreshAuthenticator] and
 * [AuthTokenRefresher] (fake IdP, in-memory token store) over a scripted MockWebServer. Concurrent requests run on
 * real threads, so single-flight is exercised end to end.
 */
class SessionRefreshReplayTest {

    private class ScriptedServer(scripts: Map<String, List<Int>>) : Dispatcher() {
        private val queues = scripts.mapValues { ConcurrentLinkedQueue(it.value) }
        val hits = ConcurrentHashMap<String, AtomicInteger>()

        override fun dispatch(request: RecordedRequest): MockResponse {
            val path = checkNotNull(request.path)
            hits.computeIfAbsent(path) { AtomicInteger() }.incrementAndGet()
            return MockResponse().setResponseCode(queues[path]?.poll() ?: SERVER_ERROR)
        }
    }

    private fun JsonObject.str(key: String) = getValue(key).jsonPrimitive.content

    @Test
    fun `every fixture case behaves as specified`() {
        BehaviorFixture.load("session-refresh").getValue("cases").jsonArray.map { it.jsonObject }.forEach(::replay)
    }

    private fun replay(case: JsonObject) {
        val id = case.str("id")
        val expect = case.getValue("expect").jsonObject
        val requests = case.getValue("requests").jsonArray.map { it.jsonObject }
        val ids = requests.map { it.str("id") }

        val authorizer = FakeOidcAuthorizer().apply {
            refreshDelayMillis = RACE_WINDOW_MS
            when (case.getValue("refresh").jsonArray.firstOrNull()?.jsonPrimitive?.content) {
                "invalid_grant" -> refreshError = AedstError.Unauthenticated("invalid_grant")
                "transient" -> refreshError = AedstError.Unavailable("HTTP 503")
            }
        }
        val store = AuthTokenStore(FakeEncryptedPreferences(), CoroutineScope(Dispatchers.Unconfined))
        runTest { store.save(AuthSession("u1", "old-access", "old-refresh", accessExpiresAtEpochSeconds = 10L)) }
        val refresher = AuthTokenRefresher(store, authorizer, mockk<Logger>(relaxed = true))

        val scripts = requests.associate {
            "/${it.str("id")}" to
                it.getValue("server").jsonArray.map { s -> s.jsonPrimitive.content.toInt() }
        }
        val scripted = ScriptedServer(scripts)
        val server = MockWebServer().apply {
            dispatcher = scripted
            start()
        }
        val client = OkHttpClient.Builder().authenticator(TokenRefreshAuthenticator(dagger.Lazy { refresher })).build()
        val pool = Executors.newFixedThreadPool(ids.size)
        try {
            val results = ids.associateWith { rid ->
                pool.submit<String> { call(client, server, rid) }
            }.mapValues { it.value.get(TIMEOUT_SECONDS, TimeUnit.SECONDS) }

            assertEquals(
                expect.getValue("results").jsonObject.mapValues {
                    it.value.jsonPrimitive.content
                },
                results,
                "$id: results",
            )
            assertEquals(expect.str("refreshCalls").toInt(), authorizer.refreshCalls, "$id: refresh calls")
            val session = if (store.session.value != null) "signed_in" else "signed_out"
            assertEquals(expect.str("session"), session, "$id: session")
            ids.forEach { rid ->
                val replays = (scripted.hits["/$rid"]?.get() ?: 0) - 1
                assertEquals(expect.getValue("replays").jsonObject.str(rid).toInt(), replays, "$id/$rid: replays")
            }
        } finally {
            pool.shutdownNow()
            server.shutdown()
        }
    }

    /** Maps the wire outcome to the fixture vocabulary: 2xx ok, 401 unauthenticated, I/O failure retryable_error. */
    private fun call(client: OkHttpClient, server: MockWebServer, id: String): String = try {
        client.newCall(
            Request.Builder().url(server.url("/$id")).header("Authorization", "Bearer old-access")
                .post(ByteArray(0).toRequestBody()).build(),
        ).execute().use { response ->
            when (response.code) {
                HTTP_OK -> "ok"
                HTTP_UNAUTHORIZED -> "unauthenticated"
                else -> "http_${response.code}"
            }
        }
    } catch (@Suppress("SwallowedException") e: IOException) {
        "retryable_error"
    }

    private companion object {
        const val SERVER_ERROR = 500
        const val HTTP_OK = 200
        const val HTTP_UNAUTHORIZED = 401
        const val RACE_WINDOW_MS = 50L
        const val TIMEOUT_SECONDS = 20L
    }
}
