import GRDB

/// Migrations owned by `AedstPersistence` itself (schema every feature can
/// rely on). Feature-specific tables belong in that feature's own
/// `registerMigrations(in:)`, not here.
enum AedstBaseMigrations {
    static func register(in migrator: inout DatabaseMigrator) {
        migrator.registerMigration("core.v1_createKeyValue") { db in
            try db.create(table: AedstKeyValueRecord.databaseTableName) { table in
                table.primaryKey("key", .text)
                table.column("value", .blob).notNull()
                table.column("updatedAt", .datetime).notNull()
            }
        }

        // Offline write queue (behaviour `offline-outbox`). `seq` orders delivery (FIFO); `id` is unique so a
        // double enqueue of the same intent is ignored, and doubles as the Idempotency-Key.
        migrator.registerMigration("core.v2_createOutbox") { db in
            try db.create(table: OutboxRecord.databaseTableName) { table in
                table.autoIncrementedPrimaryKey("seq")
                table.column("id", .text).notNull().unique()
                table.column("type", .text).notNull()
                table.column("payload", .text).notNull()
                table.column("status", .text).notNull().defaults(to: OutboxRecord.pendingStatus)
                table.column("attempts", .integer).notNull().defaults(to: 0)
                table.column("lastError", .text)
                table.column("createdAt", .datetime).notNull()
            }
            try db.create(index: "aedstOutbox_status_seq", on: OutboxRecord.databaseTableName, columns: ["status", "seq"])
        }
    }
}
