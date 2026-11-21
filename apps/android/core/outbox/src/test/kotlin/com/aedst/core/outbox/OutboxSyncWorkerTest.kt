package com.aedst.core.outbox

import android.content.Context
import androidx.room3.Room
import androidx.sqlite.driver.AndroidSQLiteDriver
import androidx.test.core.app.ApplicationProvider
import androidx.work.ListenableWorker.Result
import androidx.work.WorkerFactory
import androidx.work.WorkerParameters
import androidx.work.testing.TestListenableWorkerBuilder
import com.aedst.core.common.AedstError
import com.aedst.core.common.Logger
import com.aedst.core.common.Outcome
import com.aedst.core.database.AppDatabase
import com.aedst.core.database.OutboxDao
import com.aedst.core.database.OutboxEntity
import com.aedst.core.testing.fixedClock
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import java.util.concurrent.TimeUnit

@RunWith(RobolectricTestRunner::class)
class OutboxSyncWorkerTest {

    private class ScriptedHandler(override val type: String, private val script: (OutboxItem) -> Outcome<Unit>) :
        OutboxHandler {
        val seen = mutableListOf<OutboxItem>()
        override suspend fun deliver(item: OutboxItem): Outcome<Unit> {
            seen += item
            return script(item)
        }
    }

    private val context: Context = ApplicationProvider.getApplicationContext()
    private lateinit var database: AppDatabase
    private lateinit var dao: OutboxDao
    private val clock = fixedClock(NOW_MS)
    private val logger = object : Logger {
        override fun debug(tag: String, message: String) = Unit
        override fun warn(tag: String, message: String, throwable: Throwable?) = Unit
        override fun error(tag: String, message: String, throwable: Throwable?) = Unit
    }

    @Before
    fun setUp() {
        database = Room.inMemoryDatabaseBuilder(context, AppDatabase::class.java)
            .setDriver(AndroidSQLiteDriver())
            .allowMainThreadQueries()
            .build()
        dao = database.outboxDao()
    }

    @After
    fun tearDown() {
        database.close()
    }

    private fun enqueue(id: String, at: Long, type: String = "task.create") = runBlocking {
        dao.insert(OutboxEntity(id = id, type = type, payload = "payload-$id", createdAtEpochMs = NOW_MS + at))
    }

    private fun run(vararg handlers: OutboxHandler): Result = runBlocking {
        val factory = object : WorkerFactory() {
            override fun createWorker(
                appContext: Context,
                workerClassName: String,
                workerParameters: WorkerParameters,
            ) = OutboxSyncWorker(appContext, workerParameters, dao, handlers.toSet(), logger, clock)
        }
        TestListenableWorkerBuilder<OutboxSyncWorker>(context).setWorkerFactory(factory).build().doWork()
    }

    private fun pendingIds() = runBlocking { dao.pending(100).map { it.id } }

    @Test
    fun `delivers everything in creation order and empties the queue`() {
        enqueue("b", at = 2)
        enqueue("a", at = 1)
        val handler = ScriptedHandler("task.create") { Outcome.Success(Unit) }

        val result = run(handler)

        assertEquals(Result.success(), result)
        assertEquals(listOf("a", "b"), handler.seen.map { it.id }) // id doubles as the idempotency key
        assertEquals(emptyList<String>(), pendingIds())
    }

    @Test
    fun `a retryable failure stops the run, keeps the item and asks WorkManager to retry`() {
        enqueue("a", at = 1)
        enqueue("b", at = 2)
        val handler = ScriptedHandler("task.create") { Outcome.Failure(AedstError.Offline()) }

        val result = run(handler)

        assertEquals(Result.retry(), result)
        assertEquals(listOf("a"), handler.seen.map { it.id }) // b must not overtake a
        assertEquals(listOf("a", "b"), pendingIds())
        assertEquals(1, runBlocking { dao.pending(10) }.first().attempts)
    }

    @Test
    fun `a permanent failure parks that item and continues with the rest`() {
        enqueue("bad", at = 1)
        enqueue("good", at = 2)
        val handler = ScriptedHandler("task.create") {
            if (it.id == "bad") Outcome.Failure(AedstError.InvalidInput("rejected")) else Outcome.Success(Unit)
        }

        val result = run(handler)

        assertEquals(Result.success(), result)
        assertEquals(emptyList<String>(), pendingIds())
        assertEquals(listOf("bad"), runBlocking { dao.failed(10) }.map { it.id })
    }

    @Test
    fun `gives up after too many retryable failures instead of retrying forever`() {
        runBlocking {
            dao.insert(OutboxEntity("a", "task.create", "p", createdAtEpochMs = NOW_MS, attempts = 7))
        }
        val handler = ScriptedHandler("task.create") { Outcome.Failure(AedstError.Unavailable("down")) }

        val result = run(handler)

        assertEquals(Result.success(), result)
        assertEquals(listOf("a"), runBlocking { dao.failed(10) }.map { it.id })
    }

    @Test
    fun `an item with no registered handler is parked, not retried forever`() {
        enqueue("orphan", at = 1, type = "unknown.type")

        val result = run(ScriptedHandler("task.create") { Outcome.Success(Unit) })

        assertEquals(Result.success(), result)
        assertEquals(emptyList<String>(), pendingIds())
        assertEquals("NoHandler", runBlocking { dao.failed(10) }.single().lastError)
    }

    @Test
    fun `a handler that throws is treated as a permanent failure`() {
        enqueue("boom", at = 1)
        enqueue("next", at = 2)
        val handler = ScriptedHandler("task.create") {
            if (it.id == "boom") error("bug in handler") else Outcome.Success(Unit)
        }

        val result = run(handler)

        assertEquals(Result.success(), result)
        assertEquals(listOf("boom"), runBlocking { dao.failed(10) }.map { it.id })
    }

    @Test
    fun `the last allowed retryable attempt is still retried and records the error kind`() {
        runBlocking { dao.insert(OutboxEntity("a", "task.create", "p", createdAtEpochMs = NOW_MS, attempts = 6)) }
        val handler = ScriptedHandler("task.create") { Outcome.Failure(AedstError.Offline()) }

        val result = run(handler)

        assertEquals(Result.retry(), result)
        val row = runBlocking { dao.pending(10) }.single()
        assertEquals(7, row.attempts)
        assertEquals("Offline", row.lastError)
    }

    @Test
    fun `rate limiting is retried, the handler sees how many attempts happened before`() {
        runBlocking { dao.insert(OutboxEntity("a", "task.create", "p", createdAtEpochMs = NOW_MS, attempts = 3)) }
        val handler = ScriptedHandler("task.create") { Outcome.Failure(AedstError.RateLimited()) }

        val result = run(handler)

        assertEquals(Result.retry(), result)
        assertEquals(3, handler.seen.single().attempts)
        assertEquals(listOf("a"), pendingIds())
    }

    @Test
    fun `a retryable failure after a delivered item keeps the delivered item removed`() {
        enqueue("done", at = 1)
        enqueue("later", at = 2)
        val handler = ScriptedHandler("task.create") {
            if (it.id == "done") Outcome.Success(Unit) else Outcome.Failure(AedstError.Unavailable("down"))
        }

        val result = run(handler)

        assertEquals(Result.retry(), result)
        assertEquals(listOf("later"), pendingIds())
    }

    @Test
    fun `an empty queue succeeds immediately`() {
        assertEquals(Result.success(), run())
    }

    @Test
    fun `a drained queue drops parked items older than 30 days and keeps newer ones`() {
        val day = TimeUnit.DAYS.toMillis(1)
        runBlocking {
            dao.insert(OutboxEntity("old", "task.create", "p", createdAtEpochMs = NOW_MS - 31 * day))
            dao.markFailed("old", "InvalidInput")
            dao.insert(OutboxEntity("recent", "task.create", "p", createdAtEpochMs = NOW_MS - 29 * day))
            dao.markFailed("recent", "InvalidInput")
        }

        val result = run()

        assertEquals(Result.success(), result)
        assertEquals(listOf("recent"), runBlocking { dao.failed(10) }.map { it.id })
    }

    @Test
    fun `a run that has to be retried leaves old parked items alone`() {
        runBlocking {
            dao.insert(OutboxEntity("old", "task.create", "p", createdAtEpochMs = 1))
            dao.markFailed("old", "InvalidInput")
        }
        enqueue("waiting", at = 0)

        val result = run(ScriptedHandler("task.create") { Outcome.Failure(AedstError.Offline()) })

        assertEquals(Result.retry(), result)
        assertEquals(listOf("old"), runBlocking { dao.failed(10) }.map { it.id })
    }

    private companion object {
        const val NOW_MS = 1_700_000_000_000L
    }
}
