package com.aedst.feature.tasks.domain

import com.aedst.core.common.AedstError
import com.aedst.core.common.NetworkMonitor
import com.aedst.core.common.Outcome
import com.aedst.core.common.isRetryable
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.flow.first

/** How a complete ended: confirmed by the server, or accepted into the offline queue. */
public sealed interface CompleteTaskResult {
    public data class Completed(val task: Task) : CompleteTaskResult

    /** Saved on the device; the outbox sends it when the network is back. The UI shows the task as done meanwhile. */
    public data object Queued : CompleteTaskResult
}

/**
 * Marks a task done, online-first with an outbox fallback (same rules as [CreateTaskUseCase]): the operation id is the
 * `Idempotency-Key` of the direct call and of the queued one. Reopening and deleting stay online-only: the server
 * state machine does not accept them out of order, and a queued delete could outlive the user's change of mind.
 *
 * No DI annotation: the domain is common code. The feature's Metro container provides it (`TasksProviders`).
 */
public class CompleteTaskUseCase(
    private val repository: TaskRepository,
    private val queue: TaskWriteQueue,
    private val network: NetworkMonitor,
) {

    public suspend operator fun invoke(taskId: TaskId): Outcome<CompleteTaskResult> {
        val operationId = newOperationId()
        if (!network.isOnline.first()) return enqueue(taskId, operationId)
        return when (val outcome = repository.complete(taskId, operationId)) {
            is Outcome.Success -> Outcome.Success(CompleteTaskResult.Completed(outcome.value))
            is Outcome.Failure -> if (outcome.error.isRetryable) enqueue(taskId, operationId) else outcome
        }
    }

    private suspend fun enqueue(taskId: TaskId, operationId: String): Outcome<CompleteTaskResult> = try {
        queue.queueComplete(taskId, operationId)
        Outcome.Success(CompleteTaskResult.Queued)
    } catch (cancellation: CancellationException) {
        throw cancellation
    } catch (@Suppress("TooGenericExceptionCaught") failure: Throwable) {
        Outcome.Failure(AedstError.Storage("Could not queue the change", failure))
    }
}
