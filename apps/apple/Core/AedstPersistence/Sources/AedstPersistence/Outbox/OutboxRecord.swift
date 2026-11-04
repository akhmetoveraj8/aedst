import Foundation
import GRDB

/// One row of the offline-write outbox (`aedstOutbox`). The table is a queue in creation order: `seq` is the
/// FIFO key, `id` is the user intent's stable id and the `Idempotency-Key` of every delivery attempt.
///
/// The database is not encrypted (see `AedstDatabase`): `payload` must not hold secrets or PII beyond what the
/// server needs to apply the write (ADR-0013, same rule as Android's `OutboxEntity`).
public struct OutboxRecord: Codable, Equatable, Sendable, FetchableRecord {
    /// GRDB table name.
    public static let databaseTableName = "aedstOutbox"

    /// `status` of a row still waiting for delivery.
    public static let pendingStatus = "pending"
    /// `status` of a parked row: never delivered again automatically.
    public static let failedStatus = "failed"

    public var seq: Int64
    public var id: String
    public var type: String
    public var payload: String
    public var status: String
    /// Failed delivery attempts that were recorded (a parked row keeps the count of the retries before it).
    public var attempts: Int
    /// Coarse error kind of the last failure (`AedstError.analyticsCategory`), never a message.
    public var lastError: String?
    public var createdAt: Date

    public init(
        seq: Int64,
        id: String,
        type: String,
        payload: String,
        status: String = OutboxRecord.pendingStatus,
        attempts: Int = 0,
        lastError: String? = nil,
        createdAt: Date = Date()
    ) {
        self.seq = seq
        self.id = id
        self.type = type
        self.payload = payload
        self.status = status
        self.attempts = attempts
        self.lastError = lastError
        self.createdAt = createdAt
    }
}
