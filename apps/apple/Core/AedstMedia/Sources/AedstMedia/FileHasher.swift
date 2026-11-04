import CryptoKit
import Foundation

/// Streaming SHA-256 of a file (CryptoKit), for `CreateUploadRequest.sha256`:
/// object storage then verifies the uploaded bytes end to end.
public enum FileHasher {
    /// Lowercase hex SHA-256 of the file at `url`, read in 1 MiB chunks.
    public static func sha256Hex(of url: URL) throws -> String {
        let handle = try FileHandle(forReadingFrom: url)
        defer { try? handle.close() }
        var hasher = SHA256()
        while let chunk = try handle.read(upToCount: 1_048_576), !chunk.isEmpty {
            hasher.update(data: chunk)
        }
        return hasher.finalize().map { String(format: "%02x", $0) }.joined()
    }
}
