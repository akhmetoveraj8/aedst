package com.aedst.core.database

import android.content.Context
import androidx.room3.Room
import androidx.room3.testing.MigrationTestHelper
import androidx.room3.useReaderConnection
import androidx.sqlite.driver.AndroidSQLiteDriver
import androidx.sqlite.execSQL
import androidx.test.core.app.ApplicationProvider
import androidx.test.platform.app.InstrumentationRegistry
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assume.assumeFalse
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import java.io.File

/**
 * Guards the committed Room schema (`core/database/schemas/<db>/<version>.json`, the "from" side of every migration):
 * the file of the current [AppDatabase.VERSION] must be the schema of the entities in the code. Two checks, because they
 * fail differently: the identity hash in the JSON must equal the one Room computes for the real `AppDatabase`
 * (runs everywhere), and `MigrationTestHelper` must be able to create a database from the JSON that the real
 * `AppDatabase` then accepts (Linux/macOS: the helper compares the requested file with its database name using `/`).
 *
 * A migration from version N to N+1 adds `helper.runMigrationsAndValidate(N + 1, listOf(MIGRATION_N_N1))` (suspend) next
 * to these tests, with rows inserted at version N first (see the Room "test migrations" guide).
 */
@RunWith(RobolectricTestRunner::class)
class AppDatabaseSchemaTest {

    private val context: Context = ApplicationProvider.getApplicationContext()

    @get:Rule
    val helper = MigrationTestHelper(
        InstrumentationRegistry.getInstrumentation(),
        context.getDatabasePath(DATABASE),
        AndroidSQLiteDriver(),
        AppDatabase::class,
        { AppDatabase_Impl() },
    )

    private val schemaFile = File("schemas/com.aedst.core.database.AppDatabase/${AppDatabase.VERSION}.json")

    @Test
    fun `the committed schema has the identity hash of the current entities`() {
        val committed = Regex(""""identityHash":\s*"([0-9a-f]+)"""").find(schemaFile.readText())?.groupValues?.get(1)
        val database = Room.inMemoryDatabaseBuilder(context, AppDatabase::class.java)
            .setDriver(AndroidSQLiteDriver())
            .allowMainThreadQueries()
            .build()
        try {
            val actual = runBlocking {
                database.useReaderConnection { connection ->
                    connection.usePrepared("SELECT identity_hash FROM room_master_table WHERE id = 42") { statement ->
                        if (statement.step()) statement.getText(0) else null
                    }
                }
            }

            assertEquals(
                "schemas/.../${AppDatabase.VERSION}.json is stale: build :core:database and commit the regenerated file",
                actual,
                committed,
            )
        } finally {
            database.close()
        }
    }

    @Test
    fun `a database created from the exported schema opens as the real database`() {
        assumeFalse(
            "MigrationTestHelper compares a file path with its database name using '/'",
            System.getProperty("os.name").orEmpty().startsWith("Windows"),
        )
        runBlocking { helper.createDatabase(AppDatabase.VERSION) }.apply {
            execSQL(
                "INSERT INTO outbox (id, type, payload, createdAtEpochMs, attempts, state) " +
                    "VALUES ('a', 'task.create', 'p', 1, 0, 'PENDING')",
            )
            close()
        }

        val database = Room.databaseBuilder(context, AppDatabase::class.java, DATABASE)
            .setDriver(AndroidSQLiteDriver())
            .build()
        try {
            assertEquals(listOf("a"), runBlocking { database.outboxDao().pending(10) }.map { it.id })
        } finally {
            database.close()
        }
    }

    private companion object {
        const val DATABASE = "schema-test"
    }
}
