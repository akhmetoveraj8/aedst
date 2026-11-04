package com.aedst.core.network

import com.aedst.core.common.AedstError
import com.aedst.core.common.isRetryable
import com.aedst.tasks.v1.ListTasksRequest
import com.aedst.tasks.v1.ListTasksResponse
import com.aedst.tasks.v1.TasksServiceClient
import com.connectrpc.Code
import com.connectrpc.ConnectErrorDetail
import com.connectrpc.ConnectException
import com.connectrpc.ErrorDetailParser
import com.connectrpc.ProtocolClientConfig
import com.connectrpc.ResponseMessage
import com.connectrpc.extensions.GoogleJavaLiteProtobufStrategy
import com.connectrpc.impl.ProtocolClient
import com.connectrpc.okhttp.ConnectOkHttpClient
import com.connectrpc.protocols.NetworkProtocol
import com.google.protobuf.CodedOutputStream
import kotlinx.coroutines.runBlocking
import okhttp3.OkHttpClient
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import okio.Buffer
import okio.ByteString.Companion.toByteString
import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Test
import java.io.ByteArrayOutputStream

/** Wire helpers shared by the upgrade tests: what `clientversion.go` sends for a too-old build. */
internal object UpgradeFixtures {
    /** `google.rpc.ErrorInfo { reason = 1; domain = 2 }` serialized like the server does. */
    fun errorInfo(reason: String): ByteArray {
        val out = ByteArrayOutputStream()
        CodedOutputStream.newInstance(out).apply {
            writeString(1, reason)
            writeString(2, "aedst")
            flush()
        }
        return out.toByteArray()
    }

    /** Connect unary error body as connect-go writes it (HTTP 400): base64 without padding in `details[].value`. */
    fun connectErrorJson(code: String, reason: String): String {
        val value = errorInfo(reason).toByteString().base64().trimEnd('=')
        return """{"code":"$code","message":"update","details":[{"type":"google.rpc.ErrorInfo","value":"$value"}]}"""
    }

    fun exceptionWith(reason: String): ConnectException {
        val parser = object : ErrorDetailParser {
            override fun <E : Any> unpack(any: com.connectrpc.AnyError, clazz: kotlin.reflect.KClass<E>): E =
                error("not used")

            override fun parseDetails(bytes: ByteArray): List<ConnectErrorDetail> = emptyList()
        }
        val detail = ConnectErrorDetail("google.rpc.ErrorInfo", Buffer().write(errorInfo(reason)).readByteString())
        return ConnectException(
            code = Code.FAILED_PRECONDITION,
            message = "update",
        ).withErrorDetails(parser, listOf(detail))
    }
}

class ClientUpgradeTest {

    private lateinit var server: MockWebServer
    private val gate = ClientUpgradeGate()
    private lateinit var tasks: TasksServiceClient

    @BeforeEach
    fun setUp() {
        server = MockWebServer().apply { start() }
        val client = ProtocolClient(
            httpClient = ConnectOkHttpClient(OkHttpClient()),
            ProtocolClientConfig(
                host = server.url("/").toString(),
                serializationStrategy = GoogleJavaLiteProtobufStrategy(),
                networkProtocol = NetworkProtocol.CONNECT,
                interceptors = listOf { _ -> ClientUpgradeInterceptor(gate) },
            ),
        )
        tasks = TasksServiceClient(client)
    }

    @AfterEach
    fun tearDown() {
        server.shutdown()
    }

    /** Sends one real ConnectRPC unary call through the interceptor and returns the response (success or failure). */
    private fun send(response: MockResponse): ResponseMessage<ListTasksResponse> {
        server.enqueue(response)
        return runBlocking { tasks.listTasks(ListTasksRequest.getDefaultInstance()) }
    }

    private fun json(status: Int, body: String) =
        MockResponse().setResponseCode(status).setHeader("Content-Type", "application/json").setBody(body)

    @Test
    fun `the gate starts open`() {
        assertFalse(gate.upgradeRequired.value)
    }

    @Test
    fun `reason CLIENT_UPGRADE_REQUIRED latches the gate and still fails the call as UpgradeRequired`() {
        val body = UpgradeFixtures.connectErrorJson("failed_precondition", "CLIENT_UPGRADE_REQUIRED")

        val response = send(json(400, body))

        // The caller still gets the failure, mapped to the dedicated (non-retryable) kind.
        assertTrue((response as ResponseMessage.Failure).cause.toAedstError() is AedstError.UpgradeRequired)

        assertTrue(gate.upgradeRequired.value)
    }

    @Test
    fun `another failed_precondition reason does not trip the gate`() {
        send(json(400, UpgradeFixtures.connectErrorJson("failed_precondition", "SOMETHING_ELSE")))

        assertFalse(gate.upgradeRequired.value)
    }

    @Test
    fun `the upgrade reason under another code does not trip the gate`() {
        send(json(400, UpgradeFixtures.connectErrorJson("invalid_argument", "CLIENT_UPGRADE_REQUIRED")))

        assertFalse(gate.upgradeRequired.value)
    }

    @Test
    fun `non-json and success responses are ignored`() {
        send(MockResponse().setResponseCode(400).setHeader("Content-Type", "text/html").setBody("<html>bad</html>"))
        send(MockResponse().setResponseCode(200).setHeader("Content-Type", "application/json").setBody("{}"))
        send(json(400, "not json at all"))

        assertFalse(gate.upgradeRequired.value)
    }

    @Test
    fun `a decoded ConnectException with the reason maps to UpgradeRequired, which is not retryable`() {
        val error = UpgradeFixtures.exceptionWith("CLIENT_UPGRADE_REQUIRED").toAedstError()

        assertTrue(error is AedstError.UpgradeRequired)
        assertFalse(error.isRetryable)
    }

    @Test
    fun `a decoded ConnectException with another reason stays a Validation error`() {
        assertTrue(UpgradeFixtures.exceptionWith("OTHER").toAedstError() is AedstError.InvalidInput)
    }

    @Test
    fun `the diagnostic message does not carry the server text`() {
        assertEquals(
            "Client upgrade required",
            UpgradeFixtures.exceptionWith("CLIENT_UPGRADE_REQUIRED").toAedstError().message,
        )
    }

    @Test
    fun `reasonOf skips unknown fields and tolerates garbage`() {
        assertEquals("X", ClientUpgrade.reasonOf(UpgradeFixtures.errorInfo("X")))
        assertEquals(null, ClientUpgrade.reasonOf(byteArrayOf(0x0a, 0x7f)))
    }
}
