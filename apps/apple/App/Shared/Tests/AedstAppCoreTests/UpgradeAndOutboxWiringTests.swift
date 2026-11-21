import AedstCore
import AedstNetwork
import AedstPersistence
import AedstTesting
import Foundation
import Tasks
import Testing
@testable import AedstAppShared

@Suite("Forced-upgrade routing")
@MainActor
struct UpgradeRequiredRoutingTests {
    @Test("the app starts without the upgrade screen")
    func startsClear() {
        let model = RootViewModel(dependencies: makeDependencies())
        #expect(!model.isUpgradeRequired)
    }

    @Test("a CLIENT_UPGRADE_REQUIRED report from the network layer raises the blocking screen")
    func reportRaisesScreen() async throws {
        let dependencies = makeDependencies()
        let model = RootViewModel(dependencies: dependencies)
        let observer = Task { await model.observeUpgradeRequired() }

        dependencies.upgradeMonitor.report()
        var polls = 0
        while !model.isUpgradeRequired, polls < 200 {
            polls += 1
            try await Task.sleep(nanoseconds: 10_000_000)
        }
        observer.cancel()

        #expect(model.isUpgradeRequired)
    }

    @Test("a session expiry does not clear the upgrade requirement: only an update does")
    func sessionEventKeepsIt() {
        let model = RootViewModel(dependencies: makeDependencies())
        model.handleUpgradeRequired()

        model.handle(.expired)

        #expect(model.isUpgradeRequired)
    }

    @Test("the App Store link needs a numeric id")
    func appStoreLink() {
        #expect(AppStoreLink.url(forID: "1234567890")?.absoluteString == "https://apps.apple.com/app/id1234567890")
        #expect(AppStoreLink.url(forID: " 42 ")?.absoluteString == "https://apps.apple.com/app/id42")
        for raw in [nil, "", "   ", "id123", "12 3", "$(AEDST_APP_STORE_ID)", "١٢٣"] as [String?] {
            #expect(AppStoreLink.url(forID: raw) == nil, "\(String(describing: raw))")
        }
    }
}

@Suite("Outbox wiring")
@MainActor
struct OutboxWiringTests {
    @Test("sign-out drops queued writes so the next user never sends them")
    func signOutClearsOutbox() async throws {
        let dependencies = makeDependencies()
        // Offline, so the enqueue-triggered drain does not try the network.
        await dependencies.outbox.coordinator.connectivityChanged(isOnline: false)
        _ = await dependencies.taskOutbox.enqueueCreate(NewTask(title: "Queued"))
        #expect(try await dependencies.outbox.repository.entries().count == 1)

        await dependencies.didSignOut()

        #expect(try await dependencies.outbox.repository.entries().isEmpty)
    }

    @Test("the Tasks feature registers handlers for exactly the fixture's known types")
    func handlersCoverKnownTypes() throws {
        struct Fixture: Decodable { let knownTypes: [String] }
        let known = try BehaviorFixture.load(Fixture.self, named: "offline-outbox").knownTypes
        let dependencies = makeDependencies()
        let handlers = AppDependencies.outboxHandlers(
            client: dependencies.authenticatedClient,
            executor: dependencies.authorizedRequests
        )

        #expect(Set(handlers.map(\.type)) == Set(known))
        #expect(handlers.count == known.count)
    }
}
