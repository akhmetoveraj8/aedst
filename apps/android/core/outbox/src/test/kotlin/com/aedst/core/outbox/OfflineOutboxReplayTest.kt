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
import com.aedst.core.testing.BehaviorFixture
import io.mockk.mockk
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import java.time.Clock
import java.time.Instant
import java.time.ZoneOffset

/**
 * Replays docs/contract/behavior/offline-outbox.json against the real [OutboxRepository], [OutboxSyncWorker] and an
 * in-memory Room [OutboxDao]. Only the handlers are scripted (outcomes per run, consumed in delivery order).
 */
@RunWith(RobolectricTestRunner::class)
class OfflineOutboxReplayTest {

    private val context: Context = ApplicationProvider.getApplicationContext()
    private lateinit var database: AppDatabase
    private lateinit var dao: OutboxDao
    private lateinit var repository: OutboxRepository
    private val logger = mockk<Logger>(relaxed = true)

    /** Strictly increasing millis so creation order is unambiguous. */
    private val clock = object : Clock() {
        private var now = 0L
        override fun getZone() = ZoneOffset.UTC
        override fun withZone(zone: java.time.ZoneId) = this
        override fun instant(): Instant = Instant.ofEpochMilli(now++)
    }

    @Before
    fun setUp() {
        database = Room.inMemoryDatabaseBuilder(context, AppDatabase::class.java)
            .setDriver(AndroidSQLiteDriver())
            .allowMainThreadQueries()
            .build()
        dao = database.outboxDao()
        repository = OutboxRepository(dao, mockk(relaxed = true), clock)
    }

    @After
    fun tearDown() {
        database.close()
    }

    private class Scripted(
        override val type: String,
        private val outcomes: ArrayDeque<String>,
        val sent: MutableList<String>,
    ) : OutboxHandler {
        override suspend fun deliver(item: OutboxItem): Outcome<Unit> {
            sent += item.id // the id is the Idempotency-Key handlers must send
            return when (val outcome = outcomes.removeFirst()) {
                "ok" -> Outcome.Success(Unit)
                "retryable" -> Outcome.Failure(AedstError.Unavailable("down"))
                "permanent" -> Outcome.Failure(AedstError.InvalidInput("rejected"))
                else -> error("unknown outcome $outcome")
            }
        }
    }

    @Test
    fun `every fixture case behaves as specified`() {
        val fixture = BehaviorFixture.load("offline-outbox")
        val known = fixture.getValue("knownTypes").jsonArray.map { it.jsonPrimitive.content }
        fixture.getValue("cases").jsonArray.map { it.jsonObject }.forEach { case ->
            tearDown() // fresh database per case (the @Before one is reused for the first)
            setUp()
            replay(case, known)
        }
    }

    private fun replay(case: JsonObject, knownTypes: List<String>) {
        val id = case.getValue("id").jsonPrimitive.content
        case.getValue("steps").jsonArray.map { it.jsonObject }.forEachIndexed { index, step ->
            val label = "$id#$index"
            step["enqueue"]?.jsonObject?.let { item ->
                runBlocking {
                    repository.enqueue(
                        type = item.getValue("type").jsonPrimitive.content,
                        payload = "payload",
                        id = item.getValue("id").jsonPrimitive.content,
                    )
                }
            }
            val run = step["run"]?.jsonObject ?: return@forEachIndexed
            val expect = step.getValue("expect").jsonObject
            repeat(step["repeatRun"]?.jsonPrimitive?.int ?: 1) { n ->
                val sent = mutableListOf<String>()
                val outcomes = ArrayDeque(run.getValue("outcomes").jsonArray.map { it.jsonPrimitive.content })
                val handlers = knownTypes.map { Scripted(it, outcomes, sent) }.toSet()
                val result = runWorker(handlers)
                val where = "$label run ${n + 1}"
                assertEquals("$where: result", expect.getValue("result").jsonPrimitive.content, resultName(result))
                if (n == (step["repeatRun"]?.jsonPrimitive?.int ?: 1) - 1) checkExpect(where, expect, sent)
            }
        }
    }

    private fun checkExpect(where: String, expect: JsonObject, sent: List<String>) {
        expect["sent"]?.let { expected ->
            val ids = expected.jsonArray.map { it.jsonObject.getValue("id").jsonPrimitive.content }
            val keys = expected.jsonArray.map { it.jsonObject.getValue("idempotencyKey").jsonPrimitive.content }
            assertEquals("$where: sent ids", ids, sent)
            assertEquals("$where: idempotency keys", keys, sent)
        }
        expect["queue"]?.let { expected -> assertQueue(where, expected.jsonArray) }
    }

    private fun assertQueue(where: String, expected: JsonArray) {
        val rows = runBlocking { dao.pending(ALL) + dao.failed(ALL) }
        val actual = rows.associate { it.id to (it.state.name.lowercase() to it.attempts) }
        val wanted = expected.map { it.jsonObject }.associate {
            val status = it["status"]?.jsonPrimitive?.content ?: "pending"
            it.getValue("id").jsonPrimitive.content to (status to (it["attempts"]?.jsonPrimitive?.int ?: 0))
        }
        assertEquals("$where: queue", wanted, actual)
    }

    private fun runWorker(handlers: Set<OutboxHandler>): Result = runBlocking {
        val factory = object : WorkerFactory() {
            override fun createWorker(
                appContext: Context,
                workerClassName: String,
                workerParameters: WorkerParameters,
            ) = OutboxSyncWorker(appContext, workerParameters, dao, handlers, logger, clock)
        }
        TestListenableWorkerBuilder<OutboxSyncWorker>(context).setWorkerFactory(factory).build().doWork()
    }

    private fun resultName(result: Result) = if (result == Result.retry()) "retry" else "complete"

    private companion object {
        const val ALL = 1000
    }
}
