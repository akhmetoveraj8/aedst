package com.aedst.core.outbox

import android.content.Context
import androidx.test.core.app.ApplicationProvider
import androidx.work.NetworkType
import androidx.work.WorkInfo
import androidx.work.WorkManager
import androidx.work.testing.WorkManagerTestInitHelper
import org.junit.Assert.assertEquals
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

/** Robolectric because WorkManager needs an Android context (JUnit 4 runner, see libs.versions.toml). */
@RunWith(RobolectricTestRunner::class)
class OutboxSchedulerTest {

    private val context: Context = ApplicationProvider.getApplicationContext()

    @Before
    fun setUp() {
        WorkManagerTestInitHelper.initializeTestWorkManager(context)
    }

    private fun scheduled(): List<WorkInfo> =
        WorkManager.getInstance(context).getWorkInfosForUniqueWork(OutboxScheduler.UNIQUE_WORK_NAME).get()

    @Test
    fun `scheduling enqueues one unique sync that waits for a connection`() {
        OutboxScheduler(context).scheduleSync()

        val work = scheduled().single()
        assertEquals(WorkInfo.State.ENQUEUED, work.state)
        assertEquals(NetworkType.CONNECTED, work.constraints.requiredNetworkType)
    }

    @Test
    fun `scheduling while a run is waiting appends a follow-up run instead of dropping the item`() {
        val scheduler = OutboxScheduler(context)

        scheduler.scheduleSync()
        scheduler.scheduleSync()

        // APPEND_OR_REPLACE keeps the first run and chains the second behind it.
        assertEquals(2, scheduled().size)
    }
}
