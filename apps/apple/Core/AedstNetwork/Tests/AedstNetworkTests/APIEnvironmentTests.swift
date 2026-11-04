import Testing
@testable import AedstNetwork

@Suite("APIEnvironment")
struct APIEnvironmentTests {
    @Test("known values resolve regardless of build type")
    func knownValues() {
        #expect(APIEnvironment.resolve("staging", allowsLocal: false) == .staging)
        #expect(APIEnvironment.resolve("production", allowsLocal: false) == .production)
        #expect(APIEnvironment.resolve("staging", allowsLocal: true) == .staging)
    }

    @Test("missing or unknown value is local in Debug")
    func debugFallback() {
        #expect(APIEnvironment.resolve(nil, allowsLocal: true) == .local)
        #expect(APIEnvironment.resolve("bogus", allowsLocal: true) == .local)
    }

    @Test("Release fails closed to production, never to local")
    func releaseFailsClosed() {
        #expect(APIEnvironment.resolve(nil, allowsLocal: false) == .production)
        #expect(APIEnvironment.resolve("local", allowsLocal: false) == .production)
        #expect(APIEnvironment.resolve("", allowsLocal: false) == .production)
    }

    @Test("only the local environment uses plaintext HTTP")
    func transportSecurity() {
        #expect(APIEnvironment.local.baseURL.scheme == "http")
        #expect(APIEnvironment.staging.baseURL.scheme == "https")
        #expect(APIEnvironment.production.baseURL.scheme == "https")
    }
}
