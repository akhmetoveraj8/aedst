import AedstCore
import Foundation
import GRDB
import Testing
@testable import AedstPersistence

@Suite("CapabilitiesCacheStore")
struct CapabilitiesCacheStoreTests {
    @Test("nothing saved loads nothing; a saved value round-trips and the newest wins")
    func roundTrip() async throws {
        let store = CapabilitiesCacheStore(writer: try AedstDatabase.openInMemory())
        #expect(await store.load() == nil)

        let first = ServerCapabilities(features: ["search": .init(enabled: false)])
        let second = ServerCapabilities(
            features: ["media": .init(enabled: true, requiredClientVersion: "1.4.0")],
            clients: ["apple": .init(minimum: "1.0.0", recommended: "1.2.0")],
            updateStatus: .recommended
        )
        await store.save(first)
        await store.save(second)

        #expect(await store.load() == second)
    }

    @Test("an undecodable row is treated as absent")
    func corruptRow() async throws {
        let database = try AedstDatabase.openInMemory()
        try await database.write { db in
            try AedstKeyValueRecord(key: CapabilitiesCacheStore.key, value: Data("not json".utf8)).save(db)
        }

        #expect(await CapabilitiesCacheStore(writer: database).load() == nil)
    }
}
