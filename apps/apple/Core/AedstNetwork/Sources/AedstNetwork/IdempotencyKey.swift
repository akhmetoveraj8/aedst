import Foundation

/// The `Idempotency-Key` request header (server: `internal/platform/idempotency`). An outbox handler passes the
/// item id so every retry of the same intent carries the same key and the server de-duplicates it.
public enum IdempotencyKey {
    public static let headerName = "Idempotency-Key"

    /// Per-call headers for a generated Connect method (`headers:` parameter).
    public static func header(for id: String) -> [String: [String]] {
        [headerName: [id]]
    }
}

extension IdempotencyKey {
    /// Like `header(for:)` for a key that may be absent: no header at all when `id` is `nil` or empty.
    public static func headers(for id: String?) -> [String: [String]] {
        guard let id, !id.isEmpty else { return [:] }
        return header(for: id)
    }
}
