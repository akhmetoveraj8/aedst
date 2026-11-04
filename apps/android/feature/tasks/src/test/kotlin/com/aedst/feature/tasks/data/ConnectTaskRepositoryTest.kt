package com.aedst.feature.tasks.data

import com.aedst.core.common.AedstError
import com.aedst.core.common.Outcome
import com.aedst.core.network.toTimestamp
import com.aedst.feature.tasks.domain.NewTask
import com.aedst.feature.tasks.domain.TaskPriority
import com.aedst.feature.tasks.domain.TaskStatus
import com.aedst.tasks.v1.CreateTaskRequest
import com.aedst.tasks.v1.TasksServiceClientInterface
import com.aedst.tasks.v1.createTaskResponse
import com.aedst.tasks.v1.getTaskResponse
import com.aedst.tasks.v1.listTasksResponse
import com.aedst.tasks.v1.task
import com.connectrpc.Code
import com.connectrpc.ConnectException
import com.connectrpc.ResponseMessage
import io.mockk.coEvery
import io.mockk.mockk
import io.mockk.slot
import kotlinx.coroutines.test.runTest
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import java.time.Instant
import com.aedst.tasks.v1.Task as ProtoTask
import com.aedst.tasks.v1.TaskPriority as ProtoTaskPriority
import com.aedst.tasks.v1.TaskStatus as ProtoTaskStatus

class ConnectTaskRepositoryTest {

    private val client = mockk<TasksServiceClientInterface>()
    private val repository = ConnectTaskRepository(client)

    private fun <T> success(message: T) = ResponseMessage.Success(message, emptyMap(), emptyMap())

    private fun protoTask(block: com.aedst.tasks.v1.TaskKt.Dsl.() -> Unit): ProtoTask = task(block)

    // --- enum mapping: explicit, never defaulting to a real state ---

    @Test
    fun `every known status maps to its domain status`() {
        assertEquals(TaskStatus.TODO, ProtoTaskStatus.TASK_STATUS_TODO.toDomain())
        assertEquals(TaskStatus.IN_PROGRESS, ProtoTaskStatus.TASK_STATUS_IN_PROGRESS.toDomain())
        assertEquals(TaskStatus.DONE, ProtoTaskStatus.TASK_STATUS_DONE.toDomain())
    }

    @Test
    fun `an unset or newer status is unknown and never silently todo`() {
        assertEquals(TaskStatus.UNKNOWN, ProtoTaskStatus.TASK_STATUS_UNSPECIFIED.toDomain())
        assertEquals(TaskStatus.UNKNOWN, ProtoTaskStatus.UNRECOGNIZED.toDomain())
        assertEquals(TaskStatus.UNKNOWN, protoTask { statusValue = UNKNOWN_ENUM_VALUE }.toDomain().status)
    }

    @Test
    fun `every known priority maps to its domain priority`() {
        assertEquals(TaskPriority.LOW, ProtoTaskPriority.TASK_PRIORITY_LOW.toDomain())
        assertEquals(TaskPriority.MEDIUM, ProtoTaskPriority.TASK_PRIORITY_MEDIUM.toDomain())
        assertEquals(TaskPriority.HIGH, ProtoTaskPriority.TASK_PRIORITY_HIGH.toDomain())
        assertEquals(TaskPriority.URGENT, ProtoTaskPriority.TASK_PRIORITY_URGENT.toDomain())
    }

    @Test
    fun `an unset or newer priority is unknown and never silently medium`() {
        assertEquals(TaskPriority.UNKNOWN, ProtoTaskPriority.TASK_PRIORITY_UNSPECIFIED.toDomain())
        assertEquals(TaskPriority.UNKNOWN, ProtoTaskPriority.UNRECOGNIZED.toDomain())
        assertEquals(TaskPriority.UNKNOWN, protoTask { priorityValue = UNKNOWN_ENUM_VALUE }.toDomain().priority)
    }

    @Test
    fun `priorities round trip to the wire and unknown is never sent as a real one`() {
        TaskPriority.selectable.forEach { assertEquals(it, it.toProto().toDomain()) }
        assertEquals(ProtoTaskPriority.TASK_PRIORITY_UNSPECIFIED, TaskPriority.UNKNOWN.toProto())
        assertFalse(TaskPriority.UNKNOWN in TaskPriority.selectable)
    }

    @Test
    fun `timestamps are optional and an absent one is null, not the epoch`() {
        val due = Instant.parse("2026-05-01T09:00:00Z")

        val withDates = protoTask { dueDate = due.toTimestamp() }.toDomain()
        val without = protoTask { id = "x" }.toDomain()

        assertEquals(due, withDates.dueDate)
        assertNull(without.dueDate)
        assertNull(without.createdAt)
        assertNull(without.completedAt)
    }

    // --- RPCs ---

    @Test
    fun `list maps the page, the cursor and the total`() = runTest {
        coEvery { client.listTasks(any(), any()) } returns success(
            listTasksResponse {
                tasks += protoTask {
                    id = "1"
                    status = ProtoTaskStatus.TASK_STATUS_DONE
                }
                tasks += protoTask {
                    id = "2"
                    statusValue = UNKNOWN_ENUM_VALUE
                }
                nextPageToken = "next"
                totalCount = 12
            },
        )

        val page = (repository.list() as Outcome.Success).value

        assertEquals(listOf("1", "2"), page.tasks.map { it.id })
        assertEquals(listOf(TaskStatus.DONE, TaskStatus.UNKNOWN), page.tasks.map { it.status })
        assertEquals("next", page.nextPageToken)
        assertEquals(12, page.totalCount)
    }

    @Test
    fun `an empty cursor means there is no next page`() = runTest {
        coEvery { client.listTasks(any(), any()) } returns success(listTasksResponse { totalCount = 0 })

        val page = (repository.list() as Outcome.Success).value

        assertNull(page.nextPageToken)
    }

    @Test
    fun `get returns the task`() = runTest {
        coEvery { client.getTask(any(), any()) } returns success(getTaskResponse { task = protoTask { id = "7" } })

        assertEquals("7", (repository.get("7") as Outcome.Success).value.id)
    }

    @Test
    fun `create trims the text and sends the chosen priority`() = runTest {
        val request = slot<CreateTaskRequest>()
        coEvery { client.createTask(capture(request), any()) } returns
            success(createTaskResponse { task = protoTask { id = "new" } })

        val outcome = repository.create(NewTask("  Write report ", " body ", TaskPriority.HIGH, null))

        assertTrue(outcome is Outcome.Success)
        assertEquals("Write report", request.captured.title)
        assertEquals("body", request.captured.description)
        assertEquals(ProtoTaskPriority.TASK_PRIORITY_HIGH, request.captured.priority)
        assertFalse(request.captured.hasDueDate())
    }

    @Test
    fun `a server error becomes a typed failure instead of an exception`() = runTest {
        coEvery { client.getTask(any(), any()) } returns
            ResponseMessage.Failure(ConnectException(Code.NOT_FOUND, message = "no such task"), emptyMap(), emptyMap())

        val outcome = repository.get("missing")

        assertTrue((outcome as Outcome.Failure).error is AedstError.NotFound)
    }

    private companion object {
        /** A wire value no enum constant of this build has (a newer server). */
        const val UNKNOWN_ENUM_VALUE = 99
    }
}
