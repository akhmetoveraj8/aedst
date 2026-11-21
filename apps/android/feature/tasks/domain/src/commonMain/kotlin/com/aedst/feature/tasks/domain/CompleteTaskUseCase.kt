package com.aedst.feature.tasks.domain

import com.aedst.core.common.AedstError
import com.aedst.core.common.Outcome
import com.aedst.core.common.isRetryable
import com.aedst.core.network.NetworkMonitor
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.flow.first
import java.util.UUID
import javax.inject.Inject

/** How a complete ended: confirmed by the server, or accepted into the offline queue. */
internal sealed interface CompleteTaskResult {
    data class Completed(val task: Task) : CompleteTaskResult

    /** Saved on the device; the outbox sends it when the network is back. The UI shows the task as done meanwhile. */
    data object Queued : CompleteTaskResult
}

/**
 * Marks a task done, online-first with an outbox fallback (same rules as [CreateTaskUseCase]): the operation id is the
 * `Idempotency-Key` of the direct call and of the queued one. Reopening and deleting stay online-only: the server
 * state machine does not accept them out of order, and a queued delete could outlive the user's change of mind.
 */
internal class CompleteTaskUseCase @Inject constructor(
    private val repository: TaskRepository,
    private val queue: TaskWriteQueue,
    private val network: NetworkMonitor,
) {

    suspend operator fun invoke(taskId: String): Outcome<CompleteTaskResult> {
        val operationId = UUID.randomUUID().toString()
        if (!network.isOnline.first()) return enqueue(taskId, operationId)
        return when (val outcome = repository.complete(taskId, operationId)) {
            is Outcome.Success -> Outcome.Success(CompleteTaskResult.Completed(outcome.value))
            is Outcome.Failure -> if (outcome.error.isRetryable) enqueue(taskId, operationId) else outcome
        }
    }

    private suspend fun enqueue(taskId: String, operationId: String): Outcome<CompleteTaskResult> = try {
        queue.queueComplete(taskId, operationId)
        Outcome.Success(CompleteTaskResult.Queued)
    } catch (cancellation: CancellationException) {
        throw cancellation
    } catch (@Suppress("TooGenericExceptionCaught") failure: Throwable) {
        Outcome.Failure(AedstError.Storage("Could not queue the change", failure))
    }
}
