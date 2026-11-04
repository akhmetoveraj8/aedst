package com.aedst.core.outbox

import android.content.Context
import androidx.hilt.work.HiltWorker
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters
import com.aedst.core.common.AedstError
import com.aedst.core.common.Logger
import com.aedst.core.common.Outcome
import com.aedst.core.common.isRetryable
import com.aedst.core.database.OutboxDao
import com.aedst.core.database.OutboxEntity
import dagger.assisted.Assisted
import dagger.assisted.AssistedInject
import kotlinx.coroutines.CancellationException
import java.time.Clock
import java.util.concurrent.TimeUnit

/**
 * Drains the outbox in creation order. Ordering matters (create-then-edit), so a retryable failure stops the run and
 * asks WorkManager to retry with exponential backoff rather than skipping ahead; a permanent failure parks just that
 * item and continues.
 */
@HiltWorker
class OutboxSyncWorker @AssistedInject constructor(
    @Assisted appContext: Context,
    @Assisted params: WorkerParameters,
    private val dao: OutboxDao,
    private val handlers: Set<@JvmSuppressWildcards OutboxHandler>,
    private val logger: Logger,
    private val clock: Clock,
) : CoroutineWorker(appContext, params) {

    override suspend fun doWork(): Result {
        val handlersByType = handlers.associateBy(OutboxHandler::type)
        while (true) {
            val batch = dao.pending(BATCH_SIZE)
            if (batch.isEmpty()) {
                pruneFailed()
                return Result.success()
            }
            for (row in batch) {
                if (!deliver(row, handlersByType[row.type])) return Result.retry()
            }
        }
    }

    /** Parked items nobody dealt with for [FAILED_RETENTION_DAYS] days are dropped so the table cannot grow forever. */
    private suspend fun pruneFailed() {
        val cutoff = clock.millis() - TimeUnit.DAYS.toMillis(FAILED_RETENTION_DAYS)
        dao.deleteFailedOlderThan(cutoff)
    }

    /** Returns false when the run must stop and be retried later (retryable failure). */
    private suspend fun deliver(row: OutboxEntity, handler: OutboxHandler?): Boolean {
        if (handler == null) {
            logger.error(TAG, "No OutboxHandler registered for type ${row.type}; parking item")
            dao.markFailed(row.id, lastError = "NoHandler")
            return true
        }
        return when (val outcome = attempt(row, handler)) {
            is Outcome.Success -> {
                dao.delete(row.id)
                true
            }
            is Outcome.Failure -> onFailure(row, outcome.error)
        }
    }

    private suspend fun onFailure(row: OutboxEntity, error: AedstError): Boolean {
        val kind = error::class.simpleName
        return if (error.isRetryable && row.attempts + 1 < MAX_ATTEMPTS) {
            dao.recordAttempt(row.id, kind)
            false
        } else {
            logger.warn(TAG, "Giving up on outbox item ${row.type} after ${row.attempts + 1} attempt(s): $kind")
            dao.markFailed(row.id, kind)
            true
        }
    }

    private suspend fun attempt(row: OutboxEntity, handler: OutboxHandler): Outcome<Unit> = try {
        handler.deliver(OutboxItem(row.id, row.type, row.payload, row.attempts))
    } catch (cancellation: CancellationException) {
        throw cancellation
    } catch (@Suppress("TooGenericExceptionCaught") throwable: Throwable) {
        Outcome.Failure(AedstError.Unknown(throwable.javaClass.simpleName, throwable))
    }

    private companion object {
        const val TAG = "OutboxSyncWorker"
        const val BATCH_SIZE = 50
        const val MAX_ATTEMPTS = 8
        const val FAILED_RETENTION_DAYS = 30L
    }
}
