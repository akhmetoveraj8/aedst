package com.aedst.core.network

import com.aedst.core.common.AedstError
import com.aedst.core.testing.BehaviorFixture
import com.aedst.tasks.v1.ListTasksRequest
import com.aedst.tasks.v1.TasksServiceClient
import com.connectrpc.ProtocolClientConfig
import com.connectrpc.extensions.GoogleJavaLiteProtobufStrategy
import com.connectrpc.impl.ProtocolClient
import com.connectrpc.okhttp.ConnectOkHttpClient
import com.connectrpc.protocols.NetworkProtocol
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.boolean
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import okhttp3.OkHttpClient
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Test
import java.util.Optional

/**
 * Replays docs/contract/behavior/client-version-gate.json against the client half of the gate: the real
 * [RequestHeadersInterceptor] (`X-Aedst-Client: android/<semver>`), [ClientUpgradeInterceptor] and the error mapping.
 * The server half (which versions are rejected) is verified by apps/server's own replay; here the mock server answers
 * each case with the exact rejection `clientversion.go` produces, or 200.
 */
class ClientVersionGateReplayTest {

    private lateinit var server: MockWebServer
    private val headerFormat = Regex("""^(web|android|apple|desktop)/\d+\.\d+\.\d+""")

    @BeforeEach
    fun setUp() {
        server = MockWebServer().apply { start() }
    }

    @AfterEach
    fun tearDown() {
        server.shutdown()
    }

    private fun JsonObject.str(key: String) = getValue(key).jsonPrimitive.content

    private fun cases() = BehaviorFixture.load("client-version-gate").getValue("cases").jsonArray.map { it.jsonObject }

    private fun JsonObject.allowed() = getValue("expect").jsonObject.getValue("allowed").jsonPrimitive.boolean

    @Test
    fun `every case - header identifies android and only a rejection raises the upgrade screen`() {
        cases().forEach { case ->
            val id = case.str("id")
            val expect = case.getValue("expect").jsonObject
            val gate = ClientUpgradeGate()
            val tasks = TasksServiceClient(
                ProtocolClient(
                    httpClient = ConnectOkHttpClient(
                        OkHttpClient.Builder().addInterceptor(RequestHeadersInterceptor(Optional.empty())).build(),
                    ),
                    ProtocolClientConfig(
                        host = server.url("/").toString(),
                        serializationStrategy = GoogleJavaLiteProtobufStrategy(),
                        networkProtocol = NetworkProtocol.CONNECT,
                        interceptors = listOf { _ -> ClientUpgradeInterceptor(gate) },
                    ),
                ),
            )
            val body = if (case.allowed()) {
                "{}"
            } else {
                UpgradeFixtures.connectErrorJson(expect.str("code"), expect.str("reason"))
            }
            server.enqueue(
                MockResponse().setResponseCode(if (case.allowed()) 200 else 400)
                    .setHeader("Content-Type", "application/json").setBody(body),
            )

            // The generated client always calls TasksService.List; the fixture path only names the scenario.
            runBlocking { tasks.listTasks(ListTasksRequest.getDefaultInstance()) }

            val sent = server.takeRequest().getHeader(RequestHeadersInterceptor.CLIENT_HEADER).orEmpty()
            assertTrue(headerFormat.containsMatchIn(sent) && sent.startsWith("android/"), "$id: header '$sent'")
            val showsUpgrade = expect["ui"]?.jsonPrimitive?.content == "upgrade_screen"
            assertEquals(showsUpgrade, gate.upgradeRequired.value, "$id: upgrade screen")
        }
    }

    @Test
    fun `the rejected case maps to a non-retryable UpgradeRequired error`() {
        val rejected = cases().single { !it.allowed() }
        val reason = rejected.getValue("expect").jsonObject.str("reason")

        assertTrue(UpgradeFixtures.exceptionWith(reason).toAedstError() is AedstError.UpgradeRequired)
    }
}
