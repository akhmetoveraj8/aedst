package com.aedst.core.database

import androidx.room3.ConstructedBy
import androidx.room3.Database
import androidx.room3.RoomDatabase
import androidx.room3.RoomDatabaseConstructor

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
@ConstructedBy(AppDatabaseConstructor::class)
public abstract class AppDatabase : RoomDatabase() {
    public abstract fun outboxDao(): OutboxDao

    public companion object {
        /** The `@Database` version; `scripts/check-room-schemas.sh` reads this constant. */
        public const val VERSION: Int = 1
    }
}

/**
 * How Room instantiates the generated implementation without reflection on non-Android targets. Room's KSP processor
 * writes the `actual` object for every target, hence the suppression.
 */
@Suppress("KotlinNoActualForExpect", "NO_ACTUAL_FOR_EXPECT")
public expect object AppDatabaseConstructor : RoomDatabaseConstructor<AppDatabase> {
    override fun initialize(): AppDatabase
}
