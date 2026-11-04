package com.aedst.core.database

import androidx.room3.Database
import androidx.room3.RoomDatabase

/**
 * Single Room database for the app. Each feature owns its own table(s) and
 * DAO — declared here because Room requires one `@Database` per file, but
 * a feature never queries another feature's table directly (same rule as
 * "no cross-schema SQL" on the server side); cross-feature reads go through
 * that feature's repository/`api`-equivalent instead.
 *
 * Schema changes: bump [VERSION], add an `AutoMigration`/`Migration`, and commit the new
 * `schemas/com.aedst.core.database.AppDatabase/<version>.json` the build generates (`scripts/check-room-schemas.sh`
 * fails CI without it; `AppDatabaseSchemaTest` opens the exported schema as the real database). Destructive fallback is intentionally not configured — losing queued outbox items would
 * silently drop user actions. The database is **not encrypted**: store only non-sensitive, re-fetchable data here.
 */
@Database(
    entities = [OutboxEntity::class],
    version = AppDatabase.VERSION,
    exportSchema = true,
)
abstract class AppDatabase : RoomDatabase() {
    abstract fun outboxDao(): OutboxDao

    companion object {
        /** The `@Database` version; `scripts/check-room-schemas.sh` reads this constant. */
        const val VERSION = 1
    }
}
