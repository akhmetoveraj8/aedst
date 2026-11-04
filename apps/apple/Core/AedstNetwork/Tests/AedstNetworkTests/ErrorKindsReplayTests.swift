import AedstCore
import AedstTesting
import Connect
import Foundation
import Testing
@testable import AedstNetwork

/// Replays `docs/contract/behavior/error-kinds.json` (loaded from the repository, not copied) against the real
/// `NetworkErrorMapping` and the `AedstError` flags. UNVERIFIED: never compiled (no Xcode in the authoring
/// environment); the first real build is the acceptance test.
private struct ErrorKindsFixture: Decodable {
    struct Flags: Decodable {
        let retryable: Bool
        let reportable: Bool
    }

    struct Case: Decodable {
        struct Expect: Decodable {
            let kind: String
            let retryable: Bool
            let reportable: Bool
        }

        let id: String
        let code: String?
        let reason: String?
        let transport: String?
        let expect: Expect
    }

    let kinds: [String: Flags]
    let cases: [Case]
}

@Suite("error-kinds behaviour fixture")
struct ErrorKindsReplayTests {
    private func failure(for testCase: ErrorKindsFixture.Case) throws -> Error? {
        switch testCase.transport {
        case "offline": return URLError(.notConnectedToInternet)
        case "timeout": return URLError(.timedOut)
        case "aborted": return URLError(.cancelled)
        case "storage": return nil // a local database fault is created by Persistence, not mapped from a transport error
        default: break
        }
        let name = try #require(testCase.code)
        let code = try #require(Code.allCases.first { $0.name == name }, "unknown Connect code \(name)")
        if let reason = testCase.reason {
            return ConnectError(
                code: code,
                message: nil,
                exception: nil,
                details: [ConnectError.Detail(type: "google.rpc.ErrorInfo", payload: errorInfoPayload(reason: reason))],
                metadata: [:]
            )
        }
        return ConnectError(code: code, message: "diagnostic", exception: nil, details: [], metadata: [:])
    }

    @Test("every case maps to the shared kind and flags")
    func replaysEveryCase() throws {
        let fixture = try BehaviorFixture.load(ErrorKindsFixture.self, named: "error-kinds")
        for testCase in fixture.cases {
            let mapped = try failure(for: testCase).map(NetworkErrorMapping.map) ?? .storage(reason: "db")
            #expect(mapped.kind == testCase.expect.kind, "\(testCase.id)")
            #expect(mapped.isRetryable == testCase.expect.retryable, "\(testCase.id)")
            #expect(mapped.isReportable == testCase.expect.reportable, "\(testCase.id)")
        }
    }

    @Test("every kind of the vocabulary has an AedstError case carrying the declared flags")
    func kindsCarryDeclaredFlags() throws {
        let fixture = try BehaviorFixture.load(ErrorKindsFixture.self, named: "error-kinds")
        let samples: [AedstError] = [
            .unauthenticated, .forbidden, .notFound, .invalidInput(fields: []), .conflict, .rateLimited(retryAfter: nil),
            .unavailable(reason: ""), .offline, .timeout, .cancelled, .upgradeRequired, .storage(reason: ""),
            .unknown(reason: ""),
        ]
        #expect(Set(samples.map(\.kind)) == Set(fixture.kinds.keys))
        for error in samples {
            let flags = try #require(fixture.kinds[error.kind])
            #expect(error.isRetryable == flags.retryable, "\(error.kind)")
            #expect(error.isReportable == flags.reportable, "\(error.kind)")
        }
    }

    @Test("Apple-local cases report as unknown")
    func localCasesAreUnknown() {
        #expect(AedstError.decoding(reason: "x").kind == "unknown")
        #expect(AedstError.unsupported.kind == "unknown")
    }
}
