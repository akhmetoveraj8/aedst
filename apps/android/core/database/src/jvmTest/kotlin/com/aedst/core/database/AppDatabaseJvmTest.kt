package com.aedst.core.database

import androidx.room3.Room
import androidx.sqlite.driver.bundled.BundledSQLiteDriver
import kotlinx.coroutines.test.runTest
import kotlin.test.Test
import kotlin.test.assertEquals

/**
 * Proves the common-code database works off Android: the same `AppDatabase` and DAO, opened on the plain JVM with the
 * bundled SQLite driver (the driver a desktop or iOS target would use).
 */
class AppDatabaseJvmTest {

    @Test
    fun `the outbox table is created and queried on the JVM target`() = runTest {
        val database = Room.inMemoryDatabaseBuilder<AppDatabase>().setDriver(BundledSQLiteDriver()).build()
        try {
            val dao = database.outboxDao()
            dao.insert(OutboxEntity(id = "b", type = "task.create", payload = "p", createdAtEpochMs = 2))
            dao.insert(OutboxEntity(id = "a", type = "task.create", payload = "p", createdAtEpochMs = 1))

            assertEquals(listOf("a", "b"), dao.pending(limit = 10).map { it.id })
        } finally {
            database.close()
        }
    }
}
