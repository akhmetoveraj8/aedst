import Connect
import Testing
@testable import AedstNetwork

@Suite("NetworkErrorMapping")
struct NetworkErrorMappingTests {
    @Test("unauthenticated maps to unauthorized")
    func unauthenticated() {
        let error = ConnectError(code: .unauthenticated, message: "expired", exception: nil, details: [], metadata: [:])
        #expect(NetworkErrorMapping.map(error) == .unauthenticated)
    }

    @Test("not found maps to notFound")
    func notFound() {
        let error = ConnectError(code: .notFound, message: nil, exception: nil, details: [], metadata: [:])
        #expect(NetworkErrorMapping.map(error) == .notFound)
    }

    @Test("permission denied maps to forbidden, never to a signed-out state")
    func permissionDenied() {
        let error = ConnectError(code: .permissionDenied, message: nil, exception: nil, details: [], metadata: [:])
        #expect(NetworkErrorMapping.map(error) == .forbidden)
    }

    @Test("aborted (version conflict) maps to conflict")
    func aborted() {
        let error = ConnectError(code: .aborted, message: nil, exception: nil, details: [], metadata: [:])
        #expect(NetworkErrorMapping.map(error) == .conflict)
    }

    @Test("non-Connect errors map to unknown")
    func nonConnectError() {
        struct Boom: Error {}
        if case .unknown = NetworkErrorMapping.map(Boom()) {
            // expected
        } else {
            Issue.record("expected .unknown")
        }
    }
}
