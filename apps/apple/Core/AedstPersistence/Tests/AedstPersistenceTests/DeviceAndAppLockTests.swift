import AedstTesting
import Testing
@testable import AedstPersistence

@Suite("DeviceIdentifierStore")
struct DeviceIdentifierStoreTests {
    @Test("the identifier is generated once and then stable")
    func stable() {
        let store = DeviceIdentifierStore(store: InMemorySecureStore())
        let first = store.deviceID()
        #expect(!first.isEmpty)
        #expect(store.deviceID() == first)
    }

    @Test("the same backing store keeps its identifier; a fresh one gets a new one")
    func perStore() {
        let backing = InMemorySecureStore()
        let a = DeviceIdentifierStore(store: backing).deviceID()
        let b = DeviceIdentifierStore(store: backing).deviceID()
        let other = DeviceIdentifierStore(store: InMemorySecureStore()).deviceID()
        #expect(a == b)
        #expect(a != other)
    }

    @Test("if the Keychain write fails it still returns an identifier")
    func writeFailure() {
        let store = DeviceIdentifierStore(store: InMemorySecureStore(failWrites: true))
        #expect(!store.deviceID().isEmpty)
    }
}

@Suite("AppLockPreference")
struct AppLockPreferenceTests {
    @Test("defaults to disabled and toggles")
    func toggles() throws {
        let preference = AppLockPreference(store: InMemorySecureStore())
        #expect(!preference.isEnabled)

        try preference.setEnabled(true)
        #expect(preference.isEnabled)

        try preference.setEnabled(false)
        #expect(!preference.isEnabled)
    }
}
