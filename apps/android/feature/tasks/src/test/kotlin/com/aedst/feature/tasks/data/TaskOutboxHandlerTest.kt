package com.aedst.feature.tasks.data

import com.aedst.core.common.AedstError
import com.aedst.core.common.Outcome
import com.aedst.core.outbox.OutboxItem
import com.aedst.tasks.v1.CompleteTaskRequest
import com.aedst.tasks.v1.CreateTaskRequest
import kotlinx.coroutines.test.runTest
import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertInstanceOf
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

class TaskOutboxHandlerTest {

    private val http = TaskTestServer()

    @AfterEach
    fun tearDown() = http.close()

    private fun item(id: String, type: String, payload: String) = OutboxItem(id, type, payload, attempts = 0)

    @Test
    fun `create sends the queued request with the outbox id as Idempotency-Key`() = runTest {
        http.respondCreated()
        val handler = TaskCreateOutboxHandler(http.client)

        val queued = item("op-1", TaskOutboxTypes.CREATE, createRequest("Write report").toOutboxPayload())

        val outcome = handler.deliver(queued)

        assertEquals(Outcome.Success(Unit), outcome)
        val request = http.server.takeRequest()
        assertTrue(request.path.orEmpty().endsWith("/aedst.tasks.v1.TasksService/CreateTask"))
        assertEquals("op-1", request.getHeader("Idempotency-Key"))
        assertEquals("Write report", CreateTaskRequest.parseFrom(request.body.readByteArray()).title)
    }

    @Test
    fun `a retry of the same item sends the same key again`() = runTest {
        http.respondError(503, "unavailable")
        http.respondCreated()
        val handler = TaskCreateOutboxHandler(http.client)
        val queued = item("op-1", TaskOutboxTypes.CREATE, createRequest("Write report").toOutboxPayload())

        val first = handler.deliver(queued)
        val second = handler.deliver(queued.copy(attempts = 1))

        assertInstanceOf(Outcome.Failure::class.java, first)
        assertEquals(Outcome.Success(Unit), second)
        assertEquals("op-1", http.server.takeRequest().getHeader("Idempotency-Key"))
        assertEquals("op-1", http.server.takeRequest().getHeader("Idempotency-Key"))
    }

    @Test
    fun `complete sends the task id and the key`() = runTest {
        http.respondCompleted()
        val handler = TaskCompleteOutboxHandler(http.client)

        val queued = item("op-2", TaskOutboxTypes.COMPLETE, completeRequest("t1").toOutboxPayload())

        val outcome = handler.deliver(queued)

        assertEquals(Outcome.Success(Unit), outcome)
        val request = http.server.takeRequest()
        assertTrue(request.path.orEmpty().endsWith("/aedst.tasks.v1.TasksService/CompleteTask"))
        assertEquals("op-2", request.getHeader("Idempotency-Key"))
        assertEquals("t1", CompleteTaskRequest.parseFrom(request.body.readByteArray()).id)
    }

    @Test
    fun `a server rejection is a typed failure the worker can classify`() = runTest {
        http.respondError(400, "invalid_argument")

        val outcome = TaskCreateOutboxHandler(http.client)
            .deliver(item("op-3", TaskOutboxTypes.CREATE, createRequest("x").toOutboxPayload()))

        assertInstanceOf(AedstError.InvalidInput::class.java, (outcome as Outcome.Failure).error)
    }

    @Test
    fun `an undecodable payload fails permanently without calling the server`() = runTest {
        val broken = item("op-4", TaskOutboxTypes.CREATE, "not base64 !!")

        val outcome = TaskCreateOutboxHandler(http.client).deliver(broken)

        assertInstanceOf(AedstError.Unknown::class.java, (outcome as Outcome.Failure).error)
        assertEquals(0, http.server.requestCount)
    }

    @Test
    fun `payloads round trip through the outbox column`() {
        val request = createRequest("Plan trip")

        assertEquals(request, request.toOutboxPayload().parseOutboxPayload(CreateTaskRequest.parser()))
    }
}
