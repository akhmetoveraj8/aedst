package com.aedst.feature.tasks.domain

import com.aedst.core.common.AedstError
import com.aedst.core.common.Outcome
import com.aedst.feature.tasks.FakeNetworkMonitor
import com.aedst.feature.tasks.FakeTaskWriteQueue
import com.aedst.feature.tasks.ScriptedTaskRepository
import com.aedst.feature.tasks.domainTask
import kotlinx.coroutines.test.runTest
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertInstanceOf
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

class CreateTaskUseCaseTest {

    private val repository = ScriptedTaskRepository()
    private val queue = FakeTaskWriteQueue()
    private val network = FakeNetworkMonitor()
    private val useCase = CreateTaskUseCase(repository, queue, network)

    private fun input(title: String = "Write report", description: String = "") =
        NewTask(title, description, TaskPriority.HIGH, null)

    private fun assertRejected(outcome: Outcome<CreateTaskResult>, field: String) {
        val failure = assertInstanceOf(Outcome.Failure::class.java, outcome)
        val error = assertInstanceOf(AedstError.InvalidInput::class.java, failure.error)
        assertEquals(field, error.message)
        assertTrue(repository.created.isEmpty(), "a rejected task must never reach the repository")
        assertTrue(queue.queued.isEmpty(), "a rejected task must never be queued")
    }

    @Test
    fun `a blank title is rejected without calling the repository`() = runTest {
        assertRejected(useCase(input(title = "   ")), CreateTaskUseCase.FIELD_TITLE)
    }

    @Test
    fun `a title over 200 code points is rejected and exactly 200 is accepted`() = runTest {
        assertRejected(useCase(input(title = "t".repeat(201))), CreateTaskUseCase.FIELD_TITLE)

        repository.createResult = Outcome.Success(domainTask("1"))
        assertInstanceOf(Outcome.Success::class.java, useCase(input(title = "t".repeat(200))))
    }

    @Test
    fun `title length counts code points not UTF-16 units`() = runTest {
        // 200 emoji are 400 UTF-16 units but 200 code points: valid, like the server and Desktop.
        repository.createResult = Outcome.Success(domainTask("1"))
        assertInstanceOf(Outcome.Success::class.java, useCase(input(title = "😀".repeat(200))))
    }

    @Test
    fun `a description over 4000 code points is rejected`() = runTest {
        assertRejected(useCase(input(description = "d".repeat(4_001))), CreateTaskUseCase.FIELD_DESCRIPTION)
    }

    @Test
    fun `title and description are trimmed before the repository sees them`() = runTest {
        repository.createResult = Outcome.Success(domainTask("1"))

        useCase(input(title = "  Write report \n", description = "  body  "))

        assertEquals(listOf(NewTask("Write report", "body", TaskPriority.HIGH, null)), repository.created)
    }

    @Test
    fun `a created task is returned as created and nothing is queued`() = runTest {
        val created = domainTask("42")
        repository.createResult = Outcome.Success(created)

        assertEquals(Outcome.Success(CreateTaskResult.Created(created)), useCase(input()))
        assertTrue(queue.queued.isEmpty())
    }

    @Test
    fun `a permanent failure is returned and never queued`() = runTest {
        val rejected = Outcome.Failure(AedstError.Forbidden())
        repository.createResult = rejected

        assertEquals(rejected, useCase(input()))
        assertTrue(queue.queued.isEmpty())
    }

    @Test
    fun `without a connection the task is queued and the server is not called`() = runTest {
        network.state.value = false

        val outcome = useCase(input(title = "  Write report "))

        assertEquals(Outcome.Success(CreateTaskResult.Queued), outcome)
        assertTrue(repository.created.isEmpty())
        val queued = queue.queued.single()
        assertEquals(NewTask("Write report", "", TaskPriority.HIGH, null), queued.task)
    }

    @Test
    fun `a retryable failure queues the same operation id it just sent as the idempotency key`() = runTest {
        repository.createResult = Outcome.Failure(AedstError.Unavailable("connection reset"))

        val outcome = useCase(input())

        assertEquals(Outcome.Success(CreateTaskResult.Queued), outcome)
        // The lost-response case: the server may have applied the first call; the queued retry must be the same key.
        assertEquals(repository.createKeys.single(), queue.queued.single().operationId)
    }

    @Test
    fun `a queue that cannot store the task fails with a storage error`() = runTest {
        network.state.value = false
        queue.failure = IllegalStateException("disk full")

        val failure = assertInstanceOf(Outcome.Failure::class.java, useCase(input()))

        assertInstanceOf(AedstError.Storage::class.java, failure.error)
    }
}
