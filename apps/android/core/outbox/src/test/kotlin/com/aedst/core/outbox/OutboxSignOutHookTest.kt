package com.aedst.core.outbox

import android.content.Context
import androidx.room3.Room
import androidx.sqlite.driver.AndroidSQLiteDriver
import androidx.test.core.app.ApplicationProvider
import androidx.work.WorkInfo
import androidx.work.WorkManager
import androidx.work.testing.WorkManagerTestInitHelper
import com.aedst.core.database.AppDatabase
import com.aedst.core.database.OutboxEntity
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

/** Robolectric: WorkManager and Room need an Android context (JUnit 4 runner, see libs.versions.toml). */
@RunWith(RobolectricTestRunner::class)
class OutboxSignOutHookTest {

    private val context: Context = ApplicationProvider.getApplicationContext()
    private lateinit var database: AppDatabase
    private lateinit var hook: OutboxSignOutHook
    private val scheduler by lazy { OutboxScheduler(context) }

    @Before
    fun setUp() {
        WorkManagerTestInitHelper.initializeTestWorkManager(context)
        database = Room.inMemoryDatabaseBuilder(context, AppDatabase::class.java)
            .setDriver(AndroidSQLiteDriver())
            .allowMainThreadQueries()
            .build()
        hook = OutboxSignOutHook(scheduler, database.outboxDao())
    }

    @After
    fun tearDown() {
        database.close()
    }

    @Test
    fun `the end of a session cancels the pending sync and empties the queue`() = runBlocking {
        val dao = database.outboxDao()
        dao.insert(OutboxEntity("pending", "task.create", "p", createdAtEpochMs = 1))
        dao.insert(OutboxEntity("parked", "task.create", "p", createdAtEpochMs = 2))
        dao.markFailed("parked", "InvalidInput")
        scheduler.scheduleSync()

        hook.onSessionEnded()

        assertEquals(emptyList<OutboxEntity>(), dao.pending(10))
        assertEquals(emptyList<OutboxEntity>(), dao.failed(10))
        val work = WorkManager.getInstance(context).getWorkInfosForUniqueWork(OutboxScheduler.UNIQUE_WORK_NAME).get()
        assertEquals(WorkInfo.State.CANCELLED, work.single().state)
    }

    @Test
    fun `an explicit sign-out has nothing to do before the session is cleared`() = runBlocking {
        val dao = database.outboxDao()
        dao.insert(OutboxEntity("pending", "task.create", "p", createdAtEpochMs = 1))

        hook.beforeSignOut()

        assertEquals(listOf("pending"), dao.pending(10).map { it.id })
    }
}
