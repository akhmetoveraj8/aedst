import Foundation
import GRDB

/// Generic key/value row for small local caches and flags that do not merit
/// their own table. Secrets (tokens) stay in the Keychain — see
/// `KeychainTokenStore`; never put them here.
public struct AedstKeyValueRecord: Codable, Equatable, Sendable, FetchableRecord, PersistableRecord {
    /// GRDB table name.
    public static let databaseTableName = "aedstKeyValue"

    /// Primary key.
    public var key: String
    /// Opaque payload; callers own the encoding.
    public var value: Data
    /// Last write time.
    public var updatedAt: Date

    /// Creates a row; `updatedAt` defaults to now.
    public init(key: String, value: Data, updatedAt: Date = Date()) {
        self.key = key
        self.value = value
        self.updatedAt = updatedAt
    }
}
