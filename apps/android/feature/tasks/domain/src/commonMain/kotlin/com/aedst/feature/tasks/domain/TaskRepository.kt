package com.aedst.feature.tasks.domain

import com.aedst.core.common.Outcome
import kotlin.uuid.Uuid

/** A fresh operation id (random UUID): the `Idempotency-Key` of one write, shared by its direct and queued attempts. */
public fun newOperationId(): String = Uuid.random().toString()

/** The caller's own tasks (TasksService). `user_id` is never sent: the server derives it from the token. */
public interface TaskRepository {
    public suspend fun list(pageToken: String? = null): Outcome<TaskPage>

    public suspend fun get(id: TaskId): Outcome<Task>

    /**
     * [idempotencyKey] is sent as the `Idempotency-Key`; a caller that may queue the same operation after a retryable
     * failure passes the key it queues it under, so the server sees both attempts as one.
     */
    public suspend fun create(task: NewTask, idempotencyKey: String = newOperationId()): Outcome<Task>

    public suspend fun complete(id: TaskId, idempotencyKey: String = newOperationId()): Outcome<Task>

    public suspend fun reopen(id: TaskId): Outcome<Task>

    public suspend fun delete(id: TaskId): Outcome<Unit>
}
