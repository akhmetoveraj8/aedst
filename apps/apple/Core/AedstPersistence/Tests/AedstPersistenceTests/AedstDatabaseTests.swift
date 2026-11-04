import Foundation
import GRDB
import Testing
@testable import AedstPersistence

@Suite("AedstDatabase")
struct AedstDatabaseTests {
    @Test("in-memory database is migrated with the base schema")
    func baseSchemaExists() async throws {
        let queue = try AedstDatabase.openInMemory()

        let exists = try await queue.read { db in try db.tableExists(AedstKeyValueRecord.databaseTableName) }

        #expect(exists)
    }

    @Test("key/value record round-trips")
    func keyValueRoundTrip() async throws {
        let queue = try AedstDatabase.openInMemory()
        let record = AedstKeyValueRecord(key: "greeting", value: Data("hello".utf8))

        try await queue.write { db in try record.save(db) }
        let fetched = try await queue.read { db in try AedstKeyValueRecord.fetchOne(db, key: "greeting") }

        #expect(fetched == record)
    }

    @Test("feature migrations run once; reopening does not re-run or wipe them")
    func featureMigrationsRunOnce() async throws {
        let url = Self.makeTemporaryDatabaseURL()
        defer { try? FileManager.default.removeItem(at: url.deletingLastPathComponent()) }
        let registration: AedstDatabase.MigrationRegistration = { migrator in
            migrator.registerMigration("test.v1_createWidget") { db in
                try db.create(table: "widget") { table in
                    table.autoIncrementedPrimaryKey("id")
                    table.column("name", .text).notNull()
                }
            }
        }

        let first = try AedstDatabase.openPool(at: url, registering: [registration])
        try await first.write { db in try db.execute(sql: "INSERT INTO widget (name) VALUES ('kept')") }
        let second = try AedstDatabase.openPool(at: url, registering: [registration])
        let names = try await second.read { db in try String.fetchAll(db, sql: "SELECT name FROM widget") }

        #expect(names == ["kept"])
    }

    @Test("concurrent writers are serialized without losing rows")
    func concurrentWrites() async throws {
        let url = Self.makeTemporaryDatabaseURL()
        defer { try? FileManager.default.removeItem(at: url.deletingLastPathComponent()) }
        let pool = try AedstDatabase.openPool(at: url)

        try await withThrowingTaskGroup(of: Void.self) { group in
            for index in 0..<25 {
                group.addTask {
                    let record = AedstKeyValueRecord(key: "key-\(index)", value: Data([UInt8(index)]))
                    try await pool.write { db in try record.save(db) }
                }
            }
            try await group.waitForAll()
        }
        let count = try await pool.read { db in try AedstKeyValueRecord.fetchCount(db) }

        #expect(count == 25)
    }

    private static func makeTemporaryDatabaseURL() -> URL {
        FileManager.default.temporaryDirectory
            .appendingPathComponent("aedst-tests-\(UUID().uuidString)", isDirectory: true)
            .appendingPathComponent("test.sqlite")
    }
}
