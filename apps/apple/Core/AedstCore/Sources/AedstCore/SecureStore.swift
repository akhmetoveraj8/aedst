/// Minimal secret storage seam. The Keychain implements it in production;
/// tests use an in-memory double (`AedstTesting.InMemorySecureStore`) so they
/// never depend on a real Keychain (unavailable or flaky on headless CI).
public protocol SecureStore: Sendable {
    func get(_ key: String) throws -> String?
    func set(_ value: String, for key: String) throws
    func remove(_ key: String) throws
}
