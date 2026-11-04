package com.aedst.core.outbox

import android.content.Context
import androidx.work.BackoffPolicy
import androidx.work.Constraints
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkManager
import dagger.hilt.android.qualifiers.ApplicationContext
import java.util.concurrent.TimeUnit
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Schedules [OutboxSyncWorker]. WorkManager is the right tool for battery: it defers the work until the network is
 * connected, batches with other jobs, honours Doze/App Standby and survives process death and reboot — no wake locks
 * or polling of our own.
 */
@Singleton
class OutboxScheduler @Inject constructor(@ApplicationContext private val context: Context) {

    fun scheduleSync() {
        val request = OneTimeWorkRequestBuilder<OutboxSyncWorker>()
            .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
            .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, BACKOFF_SECONDS, TimeUnit.SECONDS)
            .build()
        // APPEND_OR_REPLACE: an item enqueued while a run is in flight is picked up by a follow-up run instead of
        // being missed (KEEP) or cancelling the running delivery (REPLACE).
        WorkManager.getInstance(context)
            .enqueueUniqueWork(UNIQUE_WORK_NAME, ExistingWorkPolicy.APPEND_OR_REPLACE, request)
    }

    /** Cancels the queued and the running sync (sign-out). Rows are removed by the caller. */
    fun cancel() {
        WorkManager.getInstance(context).cancelUniqueWork(UNIQUE_WORK_NAME)
    }

    companion object {
        const val UNIQUE_WORK_NAME = "aedst-outbox-sync"
        private const val BACKOFF_SECONDS = 30L
    }
}
