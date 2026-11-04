package com.aedst.feature.tasks.domain

import com.aedst.core.common.Outcome
import java.util.UUID

/** The caller's own tasks (TasksService). `user_id` is never sent: the server derives it from the token. */
internal interface TaskRepository {
    suspend fun list(pageToken: String? = null): Outcome<TaskPage>

    suspend fun get(id: String): Outcome<Task>

    /**
     * [idempotencyKey] is sent as the `Idempotency-Key`; a caller that may queue the same operation after a retryable
     * failure passes the key it queues it under, so the server sees both attempts as one.
     */
    suspend fun create(task: NewTask, idempotencyKey: String = UUID.randomUUID().toString()): Outcome<Task>

    suspend fun complete(id: String, idempotencyKey: String = UUID.randomUUID().toString()): Outcome<Task>

    suspend fun reopen(id: String): Outcome<Task>

    suspend fun delete(id: String): Outcome<Unit>
}
