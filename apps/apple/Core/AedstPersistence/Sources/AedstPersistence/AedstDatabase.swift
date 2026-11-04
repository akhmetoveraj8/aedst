import AedstCore
import Foundation
import GRDB

/// Opens the app's single local SQLite database (GRDB) and applies every
/// registered migration before handing it back. Replaces the former
/// SwiftData `ModelContainer` factory: GRDB is kept for explicit, versioned
/// schema migrations via `DatabaseMigrator` and direct control over SQL,
/// WAL and concurrency, not for OS reach.
///
/// Concurrency: the returned `DatabasePool` / `DatabaseQueue` are `Sendable`
/// and serialize writes internally (a pool additionally runs reads
/// concurrently in WAL mode), so no extra actor is needed — call
/// `try await pool.read { db in ... }` / `try await pool.write { db in ... }`
/// from any task. Keep everything touching the database inside those closures.
///
/// Feature modules never build their own database: each exposes a
/// `registerMigrations(in:)` function and `App/Shared`'s composition root
/// passes them all here, so the app has one store and one linear migration
/// history (`DatabaseMigrator` applies unapplied migrations in registration
/// order).
public enum AedstDatabase {
    /// Registers a feature's migrations on the shared migrator. Names must be
    /// globally unique and immutable once shipped — prefix with the feature
    /// (`"auth.v1_createSessionCache"`); add new migrations, never edit old ones.
    public typealias MigrationRegistration = (_ migrator: inout DatabaseMigrator) -> Void

    /// `Application Support/AEDST/aedst.sqlite` (the directory is created by `openPool`).
    public static func defaultURL(fileManager: FileManager = .default) throws -> URL {
        try fileManager
            .url(for: .applicationSupportDirectory, in: .userDomainMask, appropriateFor: nil, create: true)
            .appendingPathComponent("AEDST", isDirectory: true)
            .appendingPathComponent("aedst.sqlite", isDirectory: false)
    }

    /// Opens (creating if needed) the on-disk database at `url` as a
    /// `DatabasePool` and migrates it to the latest schema.
    public static func openPool(
        at url: URL,
        registering registrations: [MigrationRegistration] = []
    ) throws -> DatabasePool {
        try FileManager.default.createDirectory(
            at: url.deletingLastPathComponent(),
            withIntermediateDirectories: true
        )
        #if os(iOS)
        // Encrypt at rest whenever the device has been unlocked once since boot
        // (the directory's class is inherited by the SQLite/WAL/SHM files).
        try FileManager.default.setAttributes(
            [.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication],
            ofItemAtPath: url.deletingLastPathComponent().path
        )
        #endif
        let pool = try AedstSignposter(category: "database").measureSync("openPool") {
            let pool = try DatabasePool(path: url.path, configuration: makeConfiguration())
            try makeMigrator(registering: registrations).migrate(pool)
            return pool
        }
        return pool
    }

    /// In-memory database for tests and previews. A `DatabaseQueue` (not a
    /// pool): SQLite in-memory databases cannot be shared across the multiple
    /// connections a pool opens.
    public static func openInMemory(registering registrations: [MigrationRegistration] = []) throws -> DatabaseQueue {
        let queue = try DatabaseQueue(configuration: makeConfiguration())
        try makeMigrator(registering: registrations).migrate(queue)
        return queue
    }

    static func makeMigrator(registering registrations: [MigrationRegistration]) -> DatabaseMigrator {
        var migrator = DatabaseMigrator()
        AedstBaseMigrations.register(in: &migrator)
        for registration in registrations {
            registration(&migrator)
        }
        return migrator
    }

    private static func makeConfiguration() -> Configuration {
        var configuration = Configuration()
        configuration.label = "AedstDatabase"
        #if DEBUG
        // Show bound values in statement logs / error messages in debug builds only.
        configuration.publicStatementArguments = true
        #endif
        return configuration
    }
}
