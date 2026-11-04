package com.aedst.feature.tasks.domain

import com.aedst.core.common.AedstError
import com.aedst.core.common.Outcome
import com.aedst.core.common.isRetryable
import com.aedst.core.network.NetworkMonitor
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.flow.first
import java.util.UUID
import javax.inject.Inject

/** How a create ended: on the server, or accepted into the offline queue. */
internal sealed interface CreateTaskResult {
    data class Created(val task: Task) : CreateTaskResult

    /** Saved on the device; the outbox sends it when the network is back (same `Idempotency-Key`, so once). */
    data object Queued : CreateTaskResult
}

/**
 * Validates and creates a task: the one place the create rules live on Android (the server enforces the same limits
 * through Protovalidate; Apple and Desktop have the same use case with the same numbers: title 1..200, description
 * at most 4000, both measured in code points).
 *
 * Online-first, like the web client: with a connection the task is created at once under a fresh operation id; with
 * none, or when that call fails in a way a retry can fix (`Offline`, `Unavailable`, `Timeout`, `RateLimited`), the
 * same operation id is queued in the outbox instead. Because the id is the `Idempotency-Key`, a request that did reach
 * the server but lost its response is not applied a second time when the queue delivers it.
 */
internal class CreateTaskUseCase @Inject constructor(
    private val repository: TaskRepository,
    private val queue: TaskWriteQueue,
    private val network: NetworkMonitor,
) {

    suspend operator fun invoke(input: NewTask): Outcome<CreateTaskResult> {
        val task = when (val checked = check(input)) {
            is Checked.Valid -> checked.task
            is Checked.Invalid -> return Outcome.Failure(AedstError.InvalidInput(checked.field))
        }
        val operationId = UUID.randomUUID().toString()
        if (!network.isOnline.first()) return enqueue(task, operationId)
        return when (val outcome = repository.create(task, operationId)) {
            is Outcome.Success -> Outcome.Success(CreateTaskResult.Created(outcome.value))
            is Outcome.Failure -> if (outcome.error.isRetryable) enqueue(task, operationId) else outcome
        }
    }

    private suspend fun enqueue(task: NewTask, operationId: String): Outcome<CreateTaskResult> = try {
        queue.queueCreate(task, operationId)
        Outcome.Success(CreateTaskResult.Queued)
    } catch (cancellation: CancellationException) {
        throw cancellation
    } catch (@Suppress("TooGenericExceptionCaught") failure: Throwable) {
        Outcome.Failure(AedstError.Storage("Could not queue the task", failure))
    }

    private sealed interface Checked {
        data class Valid(val task: NewTask) : Checked
        data class Invalid(val field: String) : Checked
    }

    private fun check(input: NewTask): Checked {
        val title = input.title.trim()
        val description = input.description.trim()
        return when {
            title.isEmpty() || title.codePointCount(0, title.length) > MAX_TITLE_LENGTH -> Checked.Invalid(FIELD_TITLE)
            description.codePointCount(0, description.length) > MAX_DESCRIPTION_LENGTH ->
                Checked.Invalid(FIELD_DESCRIPTION)
            else -> Checked.Valid(input.copy(title = title, description = description))
        }
    }

    companion object {
        /** Same limit as `CreateTaskRequest.title` (max_len 200). */
        const val MAX_TITLE_LENGTH = 200

        /** Same limit as `CreateTaskRequest.description` (max_len 4000). */
        const val MAX_DESCRIPTION_LENGTH = 4000

        /** The [AedstError.InvalidInput] message names the offending field; the form maps it to an inline error. */
        const val FIELD_TITLE = "title"
        const val FIELD_DESCRIPTION = "description"
    }
}
