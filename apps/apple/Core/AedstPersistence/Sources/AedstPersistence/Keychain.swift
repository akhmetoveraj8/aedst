import AedstCore
import Foundation
import Security

/// A failed `SecItem*` call. `status` is the raw `OSStatus` (look it up with
/// `SecCopyErrorMessageString`); never surfaced to users, only logged/mapped.
public struct KeychainError: Error, Sendable, Equatable, CustomStringConvertible {
    public let operation: String
    public let status: OSStatus

    public var description: String { "Keychain \(operation) failed (OSStatus \(status))" }
}

/// Generic-password Keychain wrapper — the one place `SecItem*` calls happen.
///
/// Security posture:
/// - Items use `kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly`: readable
///   after the first unlock following a boot (so background refresh and
///   push-triggered work can reach the session while the device is locked),
///   and never included in backups or migrated to another device.
/// - Not synchronised through iCloud Keychain (`kSecAttrSynchronizable = false`).
/// - Writes are an atomic upsert (`SecItemUpdate`, falling back to
///   `SecItemAdd`): there is no window where the item is absent.
/// - Failures are thrown, never swallowed.
/// - On macOS items live in the **data protection keychain** (`kSecUseDataProtectionKeychain`), the same model as
///   iOS: no per-app ACL prompts, `AfterFirstUnlock...` honoured, no file-based login keychain. It needs a signed
///   app (application identifier / team entitlement); an unsigned process (a bare `swift test` on a CI runner)
///   gets `errSecMissingEntitlement` (-34018) from it and must pass `usesDataProtectionKeychain: false`.
/// - An optional `accessGroup` (e.g. `"$(AppIdentifierPrefix)com.aedst.shared"`)
///   lets extensions/Watch share the session; it needs the matching
///   `keychain-access-groups` entitlement, so it is `nil` (app-private) by default.
public struct Keychain: SecureStore {
    private let service: String
    private let accessGroup: String?
    private let usesDataProtectionKeychain: Bool

    /// Whether macOS items use the data protection keychain. Always `true` for the shipping app; ignored on iOS
    /// (iOS has only this keychain).
    public static let defaultUsesDataProtectionKeychain = true

    public init(
        service: String = "com.aedst.apple",
        accessGroup: String? = nil,
        usesDataProtectionKeychain: Bool = Keychain.defaultUsesDataProtectionKeychain
    ) {
        self.service = service
        self.accessGroup = accessGroup
        self.usesDataProtectionKeychain = usesDataProtectionKeychain
    }

    public func set(_ value: String, for key: String) throws {
        let data = Data(value.utf8)
        let attributes: [String: Any] = [
            kSecValueData as String: data,
            // Also migrates items written by older builds under a different class
            // (e.g. WhenUnlockedThisDeviceOnly) to this one.
            kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly,
        ]

        var status = SecItemUpdate(searchQuery(for: key) as CFDictionary, attributes as CFDictionary)
        if status == errSecItemNotFound {
            var addQuery = searchQuery(for: key)
            addQuery.merge(attributes) { _, new in new }
            status = SecItemAdd(addQuery as CFDictionary, nil)
        }
        guard status == errSecSuccess else {
            throw KeychainError(operation: "write", status: status)
        }
    }

    public func get(_ key: String) throws -> String? {
        var query = searchQuery(for: key)
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne

        var result: AnyObject?
        let status = SecItemCopyMatching(query as CFDictionary, &result)
        switch status {
        case errSecSuccess:
            guard let data = result as? Data, let string = String(data: data, encoding: .utf8) else {
                throw KeychainError(operation: "decode", status: errSecDecode)
            }
            return string
        case errSecItemNotFound:
            return nil
        default:
            throw KeychainError(operation: "read", status: status)
        }
    }

    public func remove(_ key: String) throws {
        let status = SecItemDelete(searchQuery(for: key) as CFDictionary)
        guard status == errSecSuccess || status == errSecItemNotFound else {
            throw KeychainError(operation: "delete", status: status)
        }
    }

    /// Identity of the item only. Deliberately excludes `kSecAttrAccessible`:
    /// it is an attribute to *set*, and including it would stop the query
    /// from matching items stored under a different accessibility class.
    private func searchQuery(for key: String) -> [String: Any] {
        var query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: key,
            kSecAttrSynchronizable as String: false,
        ]
        if let accessGroup {
            query[kSecAttrAccessGroup as String] = accessGroup
        }
        #if os(macOS)
        if usesDataProtectionKeychain {
            query[kSecUseDataProtectionKeychain as String] = true
        }
        #endif
        return query
    }
}
