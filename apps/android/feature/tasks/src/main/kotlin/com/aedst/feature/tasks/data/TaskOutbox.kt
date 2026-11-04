package com.aedst.feature.tasks.data

import com.aedst.core.common.Outcome
import com.aedst.core.common.runCatchingOutcome
import com.aedst.core.network.idempotencyHeaders
import com.aedst.core.network.rpc
import com.aedst.core.outbox.OutboxHandler
import com.aedst.core.outbox.OutboxItem
import com.aedst.core.outbox.OutboxRepository
import com.aedst.feature.tasks.domain.NewTask
import com.aedst.feature.tasks.domain.TaskWriteQueue
import com.aedst.tasks.v1.CompleteTaskRequest
import com.aedst.tasks.v1.CreateTaskRequest
import com.aedst.tasks.v1.TasksServiceClientInterface
import com.aedst.tasks.v1.UpdateTaskRequest
import com.aedst.tasks.v1.completeTaskRequest
import com.connectrpc.Headers
import com.google.protobuf.MessageLite
import com.google.protobuf.Parser
import javax.inject.Inject
import kotlin.io.encoding.Base64

/** Outbox routing keys of the task writes that survive being offline. */
internal object TaskOutboxTypes {
    const val CREATE = "task.create"
    const val COMPLETE = "task.complete"
    const val UPDATE = "task.update"
}

/**
 * The outbox payload is the request message itself in protobuf wire format (Base64, because the column is text): the
 * handler sends exactly what the user's action built, with no second mapping to drift. The database is not
 * encrypted; a task's text is the user's own input, never a token (see ADR-0013).
 */
internal fun MessageLite.toOutboxPayload(): String = Base64.encode(toByteArray())

internal fun <R : MessageLite> String.parseOutboxPayload(parser: Parser<R>): R = parser.parseFrom(Base64.decode(this))

/** Persists task writes in the outbox, under the operation id that is also their `Idempotency-Key`. */
internal class OutboxTaskWriteQueue @Inject constructor(private val outbox: OutboxRepository) : TaskWriteQueue {
    override suspend fun queueCreate(task: NewTask, operationId: String) {
        outbox.enqueue(TaskOutboxTypes.CREATE, task.toRequest().toOutboxPayload(), operationId)
    }

    override suspend fun queueComplete(taskId: String, operationId: String) {
        val request = completeTaskRequest { id = taskId }
        outbox.enqueue(TaskOutboxTypes.COMPLETE, request.toOutboxPayload(), operationId)
    }
}

/**
 * Delivers one task write: decodes the queued request and sends it with the outbox id as `Idempotency-Key`, so a
 * retry after a lost response is the same operation to the server. An undecodable payload is a permanent failure
 * (parked, never retried).
 */
internal abstract class TaskOutboxHandler<R : MessageLite>(
    final override val type: String,
    private val parser: Parser<R>,
) : OutboxHandler {

    protected abstract suspend fun send(request: R, headers: Headers)

    final override suspend fun deliver(item: OutboxItem): Outcome<Unit> = runCatchingOutcome {
        send(item.payload.parseOutboxPayload(parser), idempotencyHeaders(item.id))
    }
}

internal class TaskCreateOutboxHandler @Inject constructor(private val client: TasksServiceClientInterface) :
    TaskOutboxHandler<CreateTaskRequest>(TaskOutboxTypes.CREATE, CreateTaskRequest.parser()) {
    override suspend fun send(request: CreateTaskRequest, headers: Headers) {
        rpc { client.createTask(request, headers) }
    }
}

internal class TaskCompleteOutboxHandler @Inject constructor(private val client: TasksServiceClientInterface) :
    TaskOutboxHandler<CompleteTaskRequest>(TaskOutboxTypes.COMPLETE, CompleteTaskRequest.parser()) {
    override suspend fun send(request: CompleteTaskRequest, headers: Headers) {
        rpc { client.completeTask(request, headers) }
    }
}

/**
 * `UpdateTask` (title / description / priority / due date). No screen edits a task yet, so nothing enqueues this
 * type today; the handler is registered so a queued update can never be parked as "no handler" once an edit form
 * exists.
 */
internal class TaskUpdateOutboxHandler @Inject constructor(private val client: TasksServiceClientInterface) :
    TaskOutboxHandler<UpdateTaskRequest>(TaskOutboxTypes.UPDATE, UpdateTaskRequest.parser()) {
    override suspend fun send(request: UpdateTaskRequest, headers: Headers) {
        rpc { client.updateTask(request, headers) }
    }
}
