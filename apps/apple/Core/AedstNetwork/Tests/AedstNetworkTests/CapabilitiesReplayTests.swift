import AedstCore
import AedstTesting
import Foundation
import Testing
@testable import AedstNetwork

/// Replays `docs/contract/behavior/capabilities.json` (loaded from the repository, not copied) against the real
/// `CapabilitiesService` / `CapabilityResolver`, with the transport and the cache replaced by doubles.
private struct CapabilitiesFixture: Decodable {
    struct Snapshot: Decodable {
        let features: [String: ServerCapabilities.Feature]
    }

    struct Build: Decodable {
        let version: String
        let features: [String]
        let flagged: [String]
    }

    struct Case: Decodable {
        let id: String
        let server: Snapshot?
        let lastKnown: Snapshot?
        let expect: [String: Bool]
    }

    let clientBuild: Build
    let cases: [Case]
}

private struct ScriptedRemote: CapabilitiesRemote {
    let result: Outcome<ServerCapabilities>

    func fetch() async -> Outcome<ServerCapabilities> { result }
}

private actor MemoryStore: CapabilitiesStore {
    private var value: ServerCapabilities?

    init(_ value: ServerCapabilities?) { self.value = value }

    func load() -> ServerCapabilities? { value }

    func save(_ capabilities: ServerCapabilities) { value = capabilities }
}

private func capabilities(_ snapshot: CapabilitiesFixture.Snapshot?) -> ServerCapabilities? {
    snapshot.map { ServerCapabilities(features: $0.features) }
}

@Suite("capability-negotiation behaviour fixture")
@MainActor
struct CapabilitiesReplayTests {
    @Test("every case: shown iff built and server-enabled; defaults, last known and version rules")
    func replaysEveryCase() async throws {
        let fixture = try BehaviorFixture.load(CapabilitiesFixture.self, named: "capabilities")
        #expect(!fixture.cases.isEmpty)
        let build = ClientBuild(
            version: fixture.clientBuild.version,
            features: Set(fixture.clientBuild.features),
            flagged: Set(fixture.clientBuild.flagged)
        )

        for fixtureCase in fixture.cases {
            let fetched = capabilities(fixtureCase.server)
            let service = CapabilitiesService(
                build: build,
                remote: ScriptedRemote(
                    result: fetched.map { .success($0) } ?? .failure(.decoding(reason: "offline"))
                ),
                store: MemoryStore(capabilities(fixtureCase.lastKnown))
            )
            // Before any fetch, a built-in feature is on and a flagged one off (rule 3).
            if fixtureCase.id == "builtin-default-enabled-without-fetch" {
                #expect(service.isEnabled("tasks"))
                #expect(!service.isEnabled("admin"))
            }

            await service.refresh()

            for (feature, expected) in fixtureCase.expect.sorted(by: { $0.key < $1.key }) {
                #expect(service.isEnabled(feature) == expected, "\(fixtureCase.id): \(feature)")
            }
        }
    }

    @Test("a successful fetch is persisted as the next launch's last known value")
    func successIsCached() async {
        let store = MemoryStore(nil)
        let fresh = ServerCapabilities(features: ["search": .init(enabled: false)])
        let service = CapabilitiesService(
            build: ClientBuild(version: "1.0.0", features: ["search"]),
            remote: ScriptedRemote(result: .success(fresh)),
            store: store
        )

        await service.refresh()

        #expect(await store.load() == fresh)
        #expect(!service.isEnabled("search"))
    }

    @Test("a failed fetch after a good one keeps the earlier answer")
    func failureKeepsInMemoryValue() async {
        let known = ServerCapabilities(features: ["search": .init(enabled: false)])
        let service = CapabilitiesService(
            build: ClientBuild(version: "1.0.0", features: ["search"]),
            remote: ScriptedRemote(result: .failure(.decoding(reason: "offline"))),
            store: MemoryStore(known)
        )

        await service.refresh()
        await service.refresh()

        #expect(!service.isEnabled("search"))
    }

    @Test("capabilities below the platform minimum report the upgrade requirement once")
    func belowMinimumReports() async {
        var reports = 0
        let window = ServerCapabilities(
            features: [:],
            clients: ["apple": .init(minimum: "2.0.0", recommended: "2.1.0")],
            updateStatus: .recommended
        )
        let service = CapabilitiesService(
            build: ClientBuild(version: "1.9.0", features: ["tasks"]),
            platform: "apple",
            remote: ScriptedRemote(result: .success(window)),
            store: MemoryStore(nil),
            onBelowMinimum: { reports += 1 }
        )

        await service.refresh()
        await service.refresh()

        #expect(service.isBelowMinimum)
        #expect(service.isUpdateRecommended)
        #expect(reports == 1)
    }

    @Test("numeric version order: 1.10 > 1.9, 1.3 == 1.3.0, junk is not comparable")
    func versionOrder() {
        #expect(VersionOrder.compare("1.10.0", "1.9.0") == .orderedDescending)
        #expect(VersionOrder.compare("1.3", "1.3.0") == .orderedSame)
        #expect(VersionOrder.compare("1.3.0", "1.4.0") == .orderedAscending)
        #expect(VersionOrder.compare("", "1.0.0") == nil)
        #expect(VersionOrder.compare("1.0.0-beta", "1.0.0") == nil)
    }

    @Test("coarse ids: listed is authoritative (enabled=false wins, typed version hides), unlisted uses defaults")
    func coarseIdSemantics() {
        let caps = ServerCapabilities(features: [
            "tasks": .init(enabled: true, requiredClientVersion: "9.0.0"),
            "media": .init(enabled: true, requiredClientVersion: "1.0.0"),
            "search": .init(enabled: false, requiredClientVersion: "0.0.1"),
        ])
        let build = ClientBuild(
            version: "1.3.0",
            features: ["tasks", "media", "search", "notifications", "admin"],
            flagged: ["admin"]
        )

        #expect(!CapabilityResolver.isEnabled("tasks", build: build, capabilities: caps))
        #expect(CapabilityResolver.isEnabled("media", build: build, capabilities: caps))
        #expect(!CapabilityResolver.isEnabled("search", build: build, capabilities: caps))
        #expect(CapabilityResolver.isEnabled("notifications", build: build, capabilities: caps))
        #expect(!CapabilityResolver.isEnabled("admin", build: build, capabilities: caps))
    }

    @Test("an unusable client version disables every version rule instead of guessing")
    func unknownVersionNeverHides() {
        let caps = ServerCapabilities(
            features: ["media": .init(enabled: true, requiredClientVersion: "9.0.0")],
            clients: ["apple": .init(minimum: "9.0.0")]
        )
        let build = ClientBuild(version: "", features: ["media"])

        #expect(CapabilityResolver.isEnabled("media", build: build, capabilities: caps))
        #expect(!CapabilityResolver.isBelowMinimum(build: build, platform: "apple", capabilities: caps))
    }
}
