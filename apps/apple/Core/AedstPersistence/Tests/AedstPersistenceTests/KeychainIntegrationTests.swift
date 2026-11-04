import Foundation
import Security
import Testing
@testable import AedstPersistence

/// Exercises the real `SecItem*` calls. Opt-in (`AEDST_KEYCHAIN_TESTS=1`)
/// because an unsigned `swift test` process on a headless CI runner often has
/// no usable keychain; run it from an app test host or locally.
@Suite(
    "Keychain (real SecItem calls)",
    .enabled(if: ProcessInfo.processInfo.environment["AEDST_KEYCHAIN_TESTS"] == "1")
)
struct KeychainIntegrationTests {
    /// macOS: the data protection keychain needs a signed host app (errSecMissingEntitlement otherwise), so a bare
    /// `swift test` uses the legacy keychain unless `AEDST_KEYCHAIN_DATA_PROTECTION=1` is set (signed test host or
    /// a local run with a development identity). iOS has only the data protection keychain; the flag is ignored.
    private static let usesDataProtection = ProcessInfo.processInfo.environment["AEDST_KEYCHAIN_DATA_PROTECTION"] == "1"

    private func makeKeychain(service: String = "com.aedst.apple.tests.\(UUID().uuidString)") -> Keychain {
        Keychain(service: service, usesDataProtectionKeychain: Self.usesDataProtection)
    }

    /// The flag every direct `SecItem` query in this file must carry, to address the same keychain.
    private func addingKeychainSelector(to query: [String: Any]) -> [String: Any] {
        #if os(macOS)
        var query = query
        if Self.usesDataProtection { query[kSecUseDataProtectionKeychain as String] = true }
        return query
        #else
        return query
        #endif
    }

    @Test("write, overwrite (upsert), read and delete")
    func roundTrip() throws {
        let keychain = makeKeychain()
        #expect(try keychain.get("k") == nil)

        try keychain.set("one", for: "k")
        try keychain.set("two", for: "k")
        #expect(try keychain.get("k") == "two")

        try keychain.remove("k")
        #expect(try keychain.get("k") == nil)
        try keychain.remove("k") // deleting a missing item is not an error
    }

    /// Attributes of the stored generic-password item (no secret data).
    private func storedAttributes(service: String, account: String) throws -> [String: Any] {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
            kSecAttrSynchronizable as String: kSecAttrSynchronizableAny,
            kSecReturnAttributes as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne,
        ]
        var result: AnyObject?
        let status = SecItemCopyMatching(addingKeychainSelector(to: query) as CFDictionary, &result)
        #expect(status == errSecSuccess)
        return (result as? [String: Any]) ?? [:]
    }

    @Test("items are AfterFirstUnlockThisDeviceOnly and not synchronised")
    func accessibilityClass() throws {
        let service = "com.aedst.apple.tests.\(UUID().uuidString)"
        let keychain = makeKeychain(service: service)
        defer { try? keychain.remove("k") }

        try keychain.set("secret", for: "k")

        let attributes = try storedAttributes(service: service, account: "k")
        #expect(attributes[kSecAttrAccessible as String] as? String == kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly as String)
        // A non-synchronised item reports 0/false or omits the attribute.
        let synchronizable = attributes[kSecAttrSynchronizable as String]
        #expect(synchronizable == nil || (synchronizable as? Bool) == false || (synchronizable as? Int) == 0)
    }

    @Test("an item stored under the old WhenUnlocked class is migrated on the next write")
    func migratesOldAccessibilityClass() throws {
        let service = "com.aedst.apple.tests.\(UUID().uuidString)"
        let keychain = makeKeychain(service: service)
        defer { try? keychain.remove("k") }

        let legacy: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: "k",
            kSecAttrSynchronizable as String: false,
            kSecValueData as String: Data("old".utf8),
            kSecAttrAccessible as String: kSecAttrAccessibleWhenUnlockedThisDeviceOnly,
        ]
        #expect(SecItemAdd(addingKeychainSelector(to: legacy) as CFDictionary, nil) == errSecSuccess)

        try keychain.set("new", for: "k")

        #expect(try keychain.get("k") == "new")
        let attributes = try storedAttributes(service: service, account: "k")
        #expect(attributes[kSecAttrAccessible as String] as? String == kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly as String)
    }
}
