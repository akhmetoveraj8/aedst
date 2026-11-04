import AedstCore
import Foundation
import GRDB

/// Last known server capabilities in the shared key/value table (`aedstKeyValue`). Not secret, not per-user
/// (the RPC is public), so it survives sign-out. A row that no longer decodes is treated as absent.
public struct CapabilitiesCacheStore: CapabilitiesStore {
    static let key = "capabilities.lastKnown"

    private let writer: any DatabaseWriter
    private let logger = AedstLogger(category: "capabilities")

    public init(writer: any DatabaseWriter) {
        self.writer = writer
    }

    /// Shares the app database that the outbox opened (one SQLite file for the whole app).
    public init(outbox: AedstOutbox) {
        self.init(writer: outbox.database)
    }

    public func load() async -> ServerCapabilities? {
        let data = try? await writer.read { db in
            try AedstKeyValueRecord.fetchOne(db, key: Self.key)?.value
        }
        return data.flatMap { try? JSONDecoder().decode(ServerCapabilities.self, from: $0) }
    }

    public func save(_ capabilities: ServerCapabilities) async {
        do {
            let record = AedstKeyValueRecord(key: Self.key, value: try JSONEncoder().encode(capabilities))
            try await writer.write { db in try record.save(db) }
        } catch {
            logger.error("Could not persist the capabilities", error: error)
        }
    }
}
