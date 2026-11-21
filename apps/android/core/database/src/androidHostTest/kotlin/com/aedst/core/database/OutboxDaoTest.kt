package com.aedst.core.database

import android.content.Context
import androidx.room3.Room
import androidx.sqlite.driver.AndroidSQLiteDriver
import androidx.test.core.app.ApplicationProvider
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

@RunWith(RobolectricTestRunner::class)
class OutboxDaoTest {

    private lateinit var database: AppDatabase
    private lateinit var dao: OutboxDao

    @Before
    fun setUp() {
        val context: Context = ApplicationProvider.getApplicationContext()
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

    private fun item(id: String, at: Long, type: String = "t") =
        OutboxEntity(id = id, type = type, payload = "{}", createdAtEpochMs = at)

    @Test
    fun `oldest returns pending items in creation order`() = runBlocking {
        dao.insert(item("b", at = 200))
        dao.insert(item("a", at = 100))
        dao.insert(item("c", at = 300))

        assertEquals(listOf("a", "b", "c"), dao.pending(limit = 10).map { it.id })
    }

    @Test
    fun `oldest honours the limit`() = runBlocking {
        (1..5).forEach { dao.insert(item("id$it", at = it.toLong())) }

        assertEquals(listOf("id1", "id2"), dao.pending(limit = 2).map { it.id })
    }

    @Test
    fun `inserting the same id twice keeps the first row - enqueue is idempotent`() = runBlocking {
        dao.insert(item("same", at = 1).copy(payload = "first"))
        val second = dao.insert(item("same", at = 2).copy(payload = "second"))

        assertEquals(-1L, second)
        assertEquals("first", dao.pending(10).single().payload)
    }

    @Test
    fun `delete removes an item`() = runBlocking {
        dao.insert(item("a", at = 1))

        dao.delete("a")

        assertEquals(emptyList<OutboxEntity>(), dao.pending(10))
    }

    @Test
    fun `recordAttempt increments attempts, keeps the item pending and stores only the error kind`() = runBlocking {
        dao.insert(item("a", at = 1))

        dao.recordAttempt("a", lastError = "Network")
        dao.recordAttempt("a", lastError = "Offline")

        val row = dao.pending(10).single()
        assertEquals(2, row.attempts)
        assertEquals(OutboxState.PENDING, row.state)
        assertEquals("Offline", row.lastError)
    }

    @Test
    fun `markFailed parks an item so it is no longer returned as pending`() = runBlocking {
        dao.insert(item("a", at = 1))
        dao.insert(item("b", at = 2))

        dao.markFailed("a", lastError = "Validation")

        assertEquals(listOf("b"), dao.pending(10).map { it.id })
        assertEquals(1, dao.observePendingCount().first())
    }

    @Test
    fun `observeCount counts pending items only`() = runBlocking {
        assertEquals(0, dao.observePendingCount().first())
        dao.insert(item("a", at = 1))
        dao.insert(item("b", at = 2))
        dao.markFailed("b", lastError = "x")

        assertEquals(1, dao.observePendingCount().first())
    }

    @Test
    fun `deleteFailedOlderThan removes only old failed items`() = runBlocking {
        dao.insert(item("old-failed", at = 10))
        dao.insert(item("new-failed", at = 1_000))
        dao.insert(item("old-pending", at = 10))
        dao.markFailed("old-failed", "x")
        dao.markFailed("new-failed", "x")

        val removed = dao.deleteFailedOlderThan(olderThanEpochMs = 500)

        assertEquals(1, removed)
        assertEquals(listOf("old-pending"), dao.pending(10).map { it.id })
        assertNull(dao.failed(10).firstOrNull { it.id == "old-failed" })
        assertEquals(listOf("new-failed"), dao.failed(10).map { it.id })
    }

    @Test
    fun `deleteAll empties the table whatever the state of the rows`() = runBlocking {
        dao.insert(item("pending", at = 1))
        dao.insert(item("parked", at = 2))
        dao.markFailed("parked", "InvalidInput")

        dao.deleteAll()

        assertEquals(emptyList<OutboxEntity>(), dao.pending(10) + dao.failed(10))
    }

    @Test
    fun `failed count follows parked rows only`() = runBlocking {
        dao.insert(item("pending", at = 1))
        dao.insert(item("parked", at = 2))
        assertEquals(0, dao.observeFailedCount().first())

        dao.markFailed("parked", "InvalidInput")

        assertEquals(1, dao.observeFailedCount().first())
        assertEquals(1, dao.observePendingCount().first())
    }

    @Test
    fun `requeueFailed makes parked rows pending again with a fresh attempt budget`() = runBlocking {
        dao.insert(item("parked", at = 1).copy(attempts = 7))
        dao.markFailed("parked", "Unavailable")

        val requeued = dao.requeueFailed()

        assertEquals(1, requeued)
        val row = dao.pending(10).single()
        assertEquals(0, row.attempts)
        assertNull(row.lastError)
        assertEquals(OutboxState.PENDING, row.state)
    }

    @Test
    fun `deleteFailed drops parked rows and keeps pending ones`() = runBlocking {
        dao.insert(item("pending", at = 1))
        dao.insert(item("parked", at = 2))
        dao.markFailed("parked", "InvalidInput")

        assertEquals(1, dao.deleteFailed())

        assertEquals(listOf("pending"), dao.pending(10).map { it.id })
        assertEquals(0, dao.observeFailedCount().first())
    }
}
