package com.aedst.feature.tasks.domain

import com.aedst.core.common.AedstError
import com.aedst.core.common.Outcome
import com.aedst.feature.tasks.FakeNetworkMonitor
import com.aedst.feature.tasks.FakeTaskWriteQueue
import com.aedst.feature.tasks.ScriptedTaskRepository
import com.aedst.feature.tasks.domainTask
import kotlinx.coroutines.test.runTest
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

class CompleteTaskUseCaseTest {

    private val repository = ScriptedTaskRepository()
    private val queue = FakeTaskWriteQueue()
    private val network = FakeNetworkMonitor()
    private val useCase = CompleteTaskUseCase(repository, queue, network)

    @Test
    fun `online the task is completed on the server with an idempotency key`() = runTest {
        val done = domainTask("1", status = TaskStatus.DONE)
        repository.completeResult = Outcome.Success(done)

        assertEquals(Outcome.Success(CompleteTaskResult.Completed(done)), useCase("1"))
        assertEquals(1, repository.completeKeys.size)
        assertTrue(queue.queued.isEmpty())
    }

    @Test
    fun `offline the completion is queued and the server is not called`() = runTest {
        network.state.value = false

        assertEquals(Outcome.Success(CompleteTaskResult.Queued), useCase("1"))

        assertTrue(repository.completed.isEmpty())
        assertEquals("1", queue.queued.single().completedTaskId)
    }

    @Test
    fun `a retryable failure queues the operation under the key it was sent with`() = runTest {
        repository.completeResult = Outcome.Failure(AedstError.Timeout())

        assertEquals(Outcome.Success(CompleteTaskResult.Queued), useCase("1"))

        assertEquals(repository.completeKeys.single(), queue.queued.single().operationId)
    }

    @Test
    fun `a permanent failure is returned and never queued`() = runTest {
        val notFound = Outcome.Failure(AedstError.NotFound())
        repository.completeResult = notFound

        assertEquals(notFound, useCase("1"))
        assertTrue(queue.queued.isEmpty())
    }
}
