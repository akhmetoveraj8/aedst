package com.aedst.feature.tasks.data

import android.content.Context
import androidx.room3.Room
import androidx.sqlite.driver.AndroidSQLiteDriver
import androidx.test.core.app.ApplicationProvider
import androidx.work.ListenableWorker.Result
import androidx.work.WorkerFactory
import androidx.work.WorkerParameters
import androidx.work.testing.TestListenableWorkerBuilder
import androidx.work.testing.WorkManagerTestInitHelper
import com.aedst.core.common.Logger
import com.aedst.core.database.AppDatabase
import com.aedst.core.outbox.OutboxHandler
import com.aedst.core.outbox.OutboxRepository
import com.aedst.core.outbox.OutboxScheduler
import com.aedst.core.outbox.OutboxSyncWorker
import com.aedst.feature.tasks.domain.NewTask
import com.aedst.feature.tasks.domain.TaskPriority
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import java.time.Clock

/**
 * The whole offline write path with nothing faked but the network edge: the task queue writes a row, the real
 * [OutboxSyncWorker] drains it through the real handlers, and the generated client sends HTTP to a MockWebServer.
 * (Robolectric: WorkManager and Room need an Android context. JUnit 4 runner, see libs.versions.toml.)
 */
@RunWith(RobolectricTestRunner::class)
class TaskOutboxDeliveryTest {

    private val context: Context = ApplicationProvider.getApplicationContext()
    private val http = TaskTestServer()
    private lateinit var database: AppDatabase
    private lateinit var queue: OutboxTaskWriteQueue
    private val logger = object : Logger {
        override fun debug(tag: String, message: String) = Unit
        override fun warn(tag: String, message: String, throwable: Throwable?) = Unit
        override fun error(tag: String, message: String, throwable: Throwable?) = Unit
    }

    @Before
    fun setUp() {
        WorkManagerTestInitHelper.initializeTestWorkManager(context)
        database = Room.inMemoryDatabaseBuilder(context, AppDatabase::class.java)
            .setDriver(AndroidSQLiteDriver())
            .allowMainThreadQueries()
            .build()
        val outbox = OutboxRepository(database.outboxDao(), OutboxScheduler(context), Clock.systemUTC())
        queue = OutboxTaskWriteQueue(outbox)
    }

    @After
    fun tearDown() {
        database.close()
        http.close()
    }

    private fun drain(): Result = runBlocking {
        val handlers: Set<OutboxHandler> = setOf(
            TaskCreateOutboxHandler(http.client),
            TaskCompleteOutboxHandler(http.client),
            TaskUpdateOutboxHandler(http.client),
        )
        val factory = object : WorkerFactory() {
            override fun createWorker(appContext: Context, workerClassName: String, params: WorkerParameters) =
                OutboxSyncWorker(appContext, params, database.outboxDao(), handlers, logger, Clock.systemUTC())
        }
        TestListenableWorkerBuilder<OutboxSyncWorker>(context).setWorkerFactory(factory).build().doWork()
    }

    @Test
    fun `a task created offline is delivered once with its operation id as the idempotency key`() {
        http.respondCreated()
        runBlocking { queue.queueCreate(NewTask("Write report", "", TaskPriority.HIGH, null), "op-1") }

        assertEquals(Result.success(), drain())

        val request = http.server.takeRequest()
        assertEquals("op-1", request.getHeader("Idempotency-Key"))
        assertEquals(1, http.server.requestCount)
        assertEquals(emptyList<Any>(), runBlocking { database.outboxDao().pending(10) })
    }

    @Test
    fun `a lost response is retried with the same key and then succeeds`() {
        http.respondError(503, "unavailable")
        http.respondCreated()
        runBlocking { queue.queueCreate(NewTask("Write report", "", TaskPriority.HIGH, null), "op-1") }

        assertEquals(Result.retry(), drain())
        assertEquals(Result.success(), drain())

        assertEquals("op-1", http.server.takeRequest().getHeader("Idempotency-Key"))
        assertEquals("op-1", http.server.takeRequest().getHeader("Idempotency-Key"))
    }

    @Test
    fun `create then complete are delivered in the order the user made them`() {
        http.respondCreated()
        http.respondCompleted()
        runBlocking {
            queue.queueCreate(NewTask("Write report", "", TaskPriority.HIGH, null), "op-1")
            queue.queueComplete("t1", "op-2")
        }

        assertEquals(Result.success(), drain())

        assertEquals("op-1", http.server.takeRequest().getHeader("Idempotency-Key"))
        assertEquals("op-2", http.server.takeRequest().getHeader("Idempotency-Key"))
    }
}
