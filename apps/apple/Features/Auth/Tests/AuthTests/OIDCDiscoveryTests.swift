import AedstCore
import Foundation
import Testing
@testable import Auth

@Suite("OIDCDiscovery")
struct OIDCDiscoveryTests {
    private func discovery(_ stub: StubTransport) -> OIDCDiscovery {
        OIDCDiscovery(configuration: OIDCFixtures.configuration, transport: stub.transport)
    }

    @Test("reads endpoints from <issuer>/.well-known/openid-configuration and caches them")
    func success() async {
        let stub = OIDCFixtures.transport()
        let discovery = discovery(stub)

        let first = await discovery.metadata()
        let second = await discovery.metadata()

        #expect(first.value?.tokenEndpoint.absoluteString == "https://idp.example.com/oauth/v2/token")
        #expect(first.value?.revocationEndpoint?.path == "/oauth/v2/revoke")
        #expect(second.value == first.value)
        #expect(stub.requests.count == 1)
        #expect(stub.requests.first?.url?.absoluteString == "https://idp.example.com/.well-known/openid-configuration")
    }

    @Test("a document whose issuer differs from the configured one is rejected")
    func issuerMismatch() async {
        let stub = OIDCFixtures.transport(
            discovery: .init(status: 200, body: OIDCFixtures.discoveryJSON(issuer: "https://evil.example.com"))
        )

        let result = await discovery(stub).metadata()

        #expect(result.value == nil)
        #expect(result.error == .decoding(reason: "discovery issuer does not match the configured issuer"))
    }

    @Test("a non-https token endpoint is rejected")
    func insecureEndpoint() async {
        let stub = OIDCFixtures.transport(
            discovery: .init(
                status: 200,
                body: OIDCFixtures.discoveryJSON(tokenEndpoint: "http://idp.example.com/oauth/v2/token")
            )
        )

        let result = await discovery(stub).metadata()

        #expect(result.value == nil)
        #expect(result.error != nil)
    }

    @Test("a server error is transient and a failed discovery is not cached")
    func serverError() async {
        let stub = OIDCFixtures.transport(discovery: .init(status: 503, body: ""))
        let discovery = discovery(stub)

        #expect(await discovery.metadata().error == .unavailable(reason: "http 503"))
        _ = await discovery.metadata()
        #expect(stub.requests.count == 2)
    }

    @Test("a transport failure maps to .unavailable")
    func transportFailure() async {
        let stub = StubTransport { _ in throw URLError(.notConnectedToInternet) }

        let result = await discovery(stub).metadata()

        guard case .failure(.unavailable) = result else {
            Issue.record("expected .unavailable, got \(result)")
            return
        }
    }
}
