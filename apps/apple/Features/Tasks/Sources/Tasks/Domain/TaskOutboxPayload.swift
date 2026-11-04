import Foundation

/// JSON stored in the outbox for the two Tasks write types. Field names are a persisted format: add optional
/// fields, never rename or repurpose one (rows queued by an older app version must still decode).
enum TaskOutboxPayload {
    struct Create: Codable, Equatable {
        var title: String
        var details: String
        var priority: String
        var dueDate: Date?

        init(_ task: NewTask) {
            title = task.title
            details = task.details
            priority = task.priority.wireName
            dueDate = task.dueDate
        }
    }

    struct Update: Codable, Equatable {
        var id: String
        var title: String?
        var details: String?
        var priority: String?
        var expectedVersion: Int32?

        init(_ update: TaskUpdate) {
            id = update.id
            title = update.title
            details = update.details
            priority = update.priority?.wireName
            expectedVersion = update.expectedVersion
        }
    }

    static func encode<Payload: Encodable>(_ payload: Payload) throws -> String {
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        encoder.outputFormatting = [.sortedKeys]
        return String(decoding: try encoder.encode(payload), as: UTF8.self)
    }

    static func decode<Payload: Decodable>(_ type: Payload.Type, from json: String) -> Payload? {
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        return try? decoder.decode(type, from: Data(json.utf8))
    }
}
