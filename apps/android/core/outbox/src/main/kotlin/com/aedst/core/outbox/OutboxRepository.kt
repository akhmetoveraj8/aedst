package com.aedst.core.outbox

import com.aedst.core.database.OutboxDao
import com.aedst.core.database.OutboxEntity
import kotlinx.coroutines.flow.Flow
import java.time.Clock
import java.util.UUID
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Front door of the offline write path: persist the operation locally, then ask [OutboxScheduler] to deliver it
 * once the device is online. Callers update their own local state optimistically and rely on this for delivery.
 */
@Singleton
class OutboxRepository @Inject constructor(
    private val dao: OutboxDao,
    private val scheduler: OutboxScheduler,
    private val clock: Clock,
) {
    /** Number of operations still waiting for delivery (drive a "syncing…" indicator with it). */
    val pendingCount: Flow<Int> = dao.observePendingCount()

    /** Operations the sync gave up on (permanent error or attempts exhausted); surface them with retry / discard. */
    val failedCount: Flow<Int> = dao.observeFailedCount()

    /** Puts every parked operation back in the queue with a fresh attempt budget and schedules delivery. */
    suspend fun retryFailed() {
        if (dao.requeueFailed() > 0) scheduler.scheduleSync()
    }

    /** Drops every parked operation: the user accepted that it will not be sent. */
    suspend fun discardFailed() {
        dao.deleteFailed()
    }

    /**
     * Queues [payload] for the handler registered for [type] and returns the operation id (also its idempotency key).
     * Pass a stable [id] when the same user intent could be enqueued twice (e.g. a double tap): the second insert is
     * ignored.
     */
    suspend fun enqueue(type: String, payload: String, id: String = UUID.randomUUID().toString()): String {
        dao.insert(OutboxEntity(id = id, type = type, payload = payload, createdAtEpochMs = clock.millis()))
        scheduler.scheduleSync()
        return id
    }
}
