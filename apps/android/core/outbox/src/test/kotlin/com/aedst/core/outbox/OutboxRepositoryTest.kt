package com.aedst.core.outbox

import com.aedst.core.database.OutboxDao
import com.aedst.core.database.OutboxEntity
import com.aedst.core.database.OutboxState
import io.mockk.coEvery
import io.mockk.coVerify
import io.mockk.coVerifyOrder
import io.mockk.mockk
import io.mockk.slot
import kotlinx.coroutines.test.runTest
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNotEquals
import org.junit.jupiter.api.Test
import java.time.Clock
import java.time.Instant
import java.time.ZoneOffset

class OutboxRepositoryTest {

    private val dao = mockk<OutboxDao>(relaxed = true)
    private val scheduler = mockk<OutboxScheduler>(relaxed = true)
    private val clock = Clock.fixed(Instant.ofEpochMilli(NOW_MS), ZoneOffset.UTC)
    private val repository = OutboxRepository(dao, scheduler, clock)

    @Test
    fun `enqueue persists a pending row stamped with the clock, then schedules delivery`() = runTest {
        val saved = slot<OutboxEntity>()
        coEvery { dao.insert(capture(saved)) } returns 1L

        val id = repository.enqueue(type = "task.create", payload = "{}")

        assertEquals(id, saved.captured.id) // the returned id is the idempotency key of the row
        assertEquals("task.create", saved.captured.type)
        assertEquals("{}", saved.captured.payload)
        assertEquals(NOW_MS, saved.captured.createdAtEpochMs)
        assertEquals(0, saved.captured.attempts)
        assertEquals(OutboxState.PENDING, saved.captured.state)
        // The row must be durable before WorkManager is asked to deliver it.
        coVerifyOrder {
            dao.insert(any())
            scheduler.scheduleSync()
        }
    }

    @Test
    fun `a caller supplied id is kept so a double tap cannot queue two operations`() = runTest {
        val saved = slot<OutboxEntity>()
        coEvery { dao.insert(capture(saved)) } returns 1L

        val id = repository.enqueue(type = "task.create", payload = "{}", id = "intent-1")

        assertEquals("intent-1", id)
        assertEquals("intent-1", saved.captured.id)
    }

    @Test
    fun `generated ids are unique per call`() = runTest {
        val first = repository.enqueue("task.create", "{}")
        val second = repository.enqueue("task.create", "{}")

        assertNotEquals(first, second)
        coVerify(exactly = 2) { scheduler.scheduleSync() }
    }

    @Test
    fun `retrying parked items requeues them and schedules delivery`() = runTest {
        coEvery { dao.requeueFailed() } returns 2

        repository.retryFailed()

        coVerifyOrder {
            dao.requeueFailed()
            scheduler.scheduleSync()
        }
    }

    @Test
    fun `retrying with nothing parked schedules nothing`() = runTest {
        coEvery { dao.requeueFailed() } returns 0

        repository.retryFailed()

        coVerify(exactly = 0) { scheduler.scheduleSync() }
    }

    @Test
    fun `discarding drops the parked items and does not schedule delivery`() = runTest {
        repository.discardFailed()

        coVerify(exactly = 1) { dao.deleteFailed() }
        coVerify(exactly = 0) { scheduler.scheduleSync() }
    }

    private companion object {
        const val NOW_MS = 1_700_000_000_000L
    }
}
