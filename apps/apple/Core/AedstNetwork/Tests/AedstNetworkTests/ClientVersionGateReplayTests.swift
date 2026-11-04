import AedstCore
import AedstTesting
import Connect
import Foundation
import os
import Testing
@testable import AedstNetwork

/// Replays `docs/contract/behavior/client-version-gate.json` against the real `RequestHeadersInterceptor`, `ClientUpgradeInterceptor`,
/// `ClientUpgradeMonitor` and `NetworkErrorMapping`. The version *comparison* is the server's job (covered by
/// `clientversion_test.go` over the same file); the client's duty, replayed here, is: send `apple/<semver>`
/// verbatim, and on the rejection the fixture describes show the upgrade screen (monitor) with a distinct error.
private struct GateFixture: Decodable {
    struct Case: Decodable {
        struct Expect: Decodable {
            let allowed: Bool
            let code: String?
            let reason: String?
            let ui: String?
        }

        let id: String
        let header: String?
        let path: String
        let expect: Expect
    }

    let cases: [Case]
}

@Suite("client-version-gate behaviour fixture")
struct ClientVersionGateReplayTests {
    private func request(through interceptor: RequestHeadersInterceptor) -> HTTPRequest<Google_Protobuf_Empty> {
        let sent = OSAllocatedUnfairLock<HTTPRequest<Google_Protobuf_Empty>?>(initialState: nil)
        interceptor.handleUnaryRequest(
            HTTPRequest(
                url: URL(string: "https://api.aedst.app/aedst.tasks.v1.TasksService/ListTasks")!,
                headers: [:],
                message: Google_Protobuf_Empty(),
                method: .post,
                trailers: nil,
                idempotencyLevel: .unknown
            )
        ) { result in
            if case .success(let request) = result { sent.withLock { $0 = request } }
        }
        return sent.withLock { $0 }!
    }

    private func respond(
        _ result: Result<Google_Protobuf_Empty, ConnectError>,
        through interceptor: ClientUpgradeInterceptor
    ) {
        interceptor.handleUnaryResponse(
            ResponseMessage(code: result.isFailure ? .failedPrecondition : .ok, headers: [:], result: result, trailers: [:])
        ) { _ in }
    }

    @Test("every case: the client sends its own header verbatim and shows the upgrade screen exactly when told")
    func replaysEveryCase() throws {
        let fixture = try BehaviorFixture.load(GateFixture.self, named: "client-version-gate")
        #expect(!fixture.cases.isEmpty)

        for gateCase in fixture.cases {
            let monitor = ClientUpgradeMonitor()
            // The header the fixture says a client of this platform sends is what the interceptor must produce.
            if let header = gateCase.header, header.hasPrefix("apple/") {
                let identity = ClientIdentity(version: String(header.dropFirst("apple/".count)))
                let sent = request(through: RequestHeadersInterceptor(identity: identity))
                #expect(sent.headers["X-Aedst-Client"] == [header], "\(gateCase.id): header")
            }

            let interceptor = ClientUpgradeInterceptor(monitor: monitor)
            if gateCase.expect.allowed {
                respond(.success(Google_Protobuf_Empty()), through: interceptor)
                #expect(!monitor.hasReported, "\(gateCase.id): an allowed call must not show the upgrade screen")
            } else {
                #expect(gateCase.expect.code == "failed_precondition")
                #expect(gateCase.expect.reason == UpgradeRequiredDetection.reason)
                let error = upgradeRequiredError()
                respond(.failure(error), through: interceptor)
                #expect(monitor.hasReported == (gateCase.expect.ui == "upgrade_screen"), "\(gateCase.id): upgrade screen")
                #expect(NetworkErrorMapping.map(error) == .upgradeRequired, "\(gateCase.id): distinct error")
            }
        }
    }

    @Test("an unrelated failure does not trigger the upgrade screen")
    func unrelatedFailureIgnored() {
        let monitor = ClientUpgradeMonitor()
        let interceptor = ClientUpgradeInterceptor(monitor: monitor)
        respond(
            .failure(ConnectError(code: .failedPrecondition, message: "nope", exception: nil, details: [], metadata: [:])),
            through: interceptor
        )
        #expect(!monitor.hasReported)
    }
}

private extension Result {
    var isFailure: Bool {
        if case .failure = self { true } else { false }
    }
}
