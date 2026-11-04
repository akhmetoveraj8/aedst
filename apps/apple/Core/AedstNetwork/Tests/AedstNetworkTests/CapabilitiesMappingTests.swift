import AedstCore
import Testing
@testable import AedstNetwork

@Suite("GetCapabilities response mapping")
struct CapabilitiesMappingTests {
    @Test("features, params, client windows and update status map to the domain model")
    func mapsResponse() {
        var response = Aedst_Capabilities_V1_GetCapabilitiesResponse()
        response.serverVersion = "dev"
        var gated = Aedst_Capabilities_V1_Feature()
        gated.enabled = true
        gated.requiredClientVersion = "1.4.0"
        // A stale params entry must not be read as the requirement any more.
        gated.params["requiredClientVersion"] = "9.9.9"
        var plain = Aedst_Capabilities_V1_Feature()
        plain.enabled = false
        response.features = ["media": gated, "new_search": plain]
        var window = Aedst_Capabilities_V1_ClientVersions()
        window.minimum = "1.0.0"
        window.recommended = "1.2.0"
        response.clients = ["apple": window]
        response.updateStatus = .recommended

        let mapped = ConnectCapabilitiesRemote.map(response)

        #expect(mapped.features["media"] == .init(enabled: true, requiredClientVersion: "1.4.0"))
        #expect(mapped.features["new_search"] == .init(enabled: false, requiredClientVersion: nil))
        #expect(mapped.clients["apple"] == .init(minimum: "1.0.0", recommended: "1.2.0"))
        #expect(mapped.updateStatus == .recommended)
    }

    @Test("coarse module ids map like any feature; an empty typed version means no requirement")
    func mapsCoarseIds() {
        var response = Aedst_Capabilities_V1_GetCapabilitiesResponse()
        var tasks = Aedst_Capabilities_V1_Feature()
        tasks.enabled = true
        var admin = Aedst_Capabilities_V1_Feature()
        admin.enabled = false
        admin.requiredClientVersion = "2.0.0"
        response.features = ["tasks": tasks, "admin": admin, "media.uploads": tasks]

        let mapped = ConnectCapabilitiesRemote.map(response)

        #expect(mapped.features["tasks"] == .init(enabled: true, requiredClientVersion: nil))
        #expect(mapped.features["media.uploads"] == .init(enabled: true, requiredClientVersion: nil))
        #expect(mapped.features["admin"] == .init(enabled: false, requiredClientVersion: "2.0.0"))
    }

    @Test("an unspecified or future update status is neutral")
    func unknownStatus() {
        #expect(ConnectCapabilitiesRemote.updateStatus(.unspecified) == .unspecified)
        #expect(ConnectCapabilitiesRemote.updateStatus(.UNRECOGNIZED(99)) == .unspecified)
    }
}
