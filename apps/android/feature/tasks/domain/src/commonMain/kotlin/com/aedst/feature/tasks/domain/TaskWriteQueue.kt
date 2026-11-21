package com.aedst.feature.tasks.domain

/**
 * Durable queue for task writes that cannot be sent right now (offline, or a retryable failure). Delivery is the
 * outbox's job (WorkManager, ordered, at-least-once); `operationId` is the `Idempotency-Key` of every attempt, so a
 * caller that already tried the write online passes the same id it used there.
 */
public interface TaskWriteQueue {
    public suspend fun queueCreate(task: NewTask, operationId: String)

    public suspend fun queueComplete(taskId: TaskId, operationId: String)
}
