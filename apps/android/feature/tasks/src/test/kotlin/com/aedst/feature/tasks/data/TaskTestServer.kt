package com.aedst.feature.tasks.data

import com.aedst.tasks.v1.CompleteTaskRequest
import com.aedst.tasks.v1.CreateTaskRequest
import com.aedst.tasks.v1.TasksServiceClient
import com.aedst.tasks.v1.TasksServiceClientInterface
import com.aedst.tasks.v1.completeTaskResponse
import com.aedst.tasks.v1.createTaskResponse
import com.aedst.tasks.v1.task
import com.connectrpc.ProtocolClientConfig
import com.connectrpc.extensions.GoogleJavaLiteProtobufStrategy
import com.connectrpc.impl.ProtocolClient
import com.connectrpc.okhttp.ConnectOkHttpClient
import com.connectrpc.protocols.NetworkProtocol
import okhttp3.OkHttpClient
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import okio.Buffer

/**
 * A real generated connect-kotlin client talking to a [MockWebServer], so the tests see exactly the HTTP request the
 * app would send (path, headers, protobuf body).
 */
internal class TaskTestServer : AutoCloseable {
    val server = MockWebServer().apply { start() }

    val client: TasksServiceClientInterface = TasksServiceClient(
        ProtocolClient(
            httpClient = ConnectOkHttpClient(OkHttpClient()),
            ProtocolClientConfig(
                host = server.url("/").toString().trimEnd('/'),
                serializationStrategy = GoogleJavaLiteProtobufStrategy(),
                networkProtocol = NetworkProtocol.CONNECT,
            ),
        ),
    )

    fun respondCreated(id: String = "created-1") {
        respond(createTaskResponse { task = task { this.id = id } }.toByteArray())
    }

    fun respondCompleted(id: String = "t1") {
        respond(completeTaskResponse { task = task { this.id = id } }.toByteArray())
    }

    fun respondError(status: Int, code: String) {
        server.enqueue(
            MockResponse().setResponseCode(status).setHeader("Content-Type", "application/json")
                .setBody("""{"code":"$code","message":"nope"}"""),
        )
    }

    private fun respond(bytes: ByteArray) {
        server.enqueue(
            MockResponse().setResponseCode(200).setHeader("Content-Type", "application/proto")
                .setBody(Buffer().write(bytes)),
        )
    }

    override fun close() = server.shutdown()
}

internal fun createRequest(title: String) = CreateTaskRequest.newBuilder().setTitle(title).build()

internal fun completeRequest(id: String) = CompleteTaskRequest.newBuilder().setId(id).build()
