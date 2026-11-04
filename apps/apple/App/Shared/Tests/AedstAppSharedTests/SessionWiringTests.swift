import Admin
import AedstAnalytics
import AedstCore
import AedstTesting
import Foundation
import Testing
@testable import AedstAppShared

@Suite("Composition root: session-scoped wiring")
@MainActor
struct SessionWiringTests {
    @Test("the list screen and every detail screen share one task list view model")
    func oneTaskListPerSession() {
        let dependencies = makeDependencies()

        let first = dependencies.makeTaskListViewModel()
        let second = dependencies.makeTaskListViewModel()
        _ = dependencies.makeTaskDetailViewModel(id: "t-1")

        #expect(first === second)
    }

    @Test("sign-out drops the shared list so the next user starts empty")
    func signOutResetsTaskList() async {
        let dependencies = makeDependencies()
        let before = dependencies.makeTaskListViewModel()

        await dependencies.didSignOut()

        #expect(dependencies.makeTaskListViewModel() !== before)
    }

    @Test("other screens still get a fresh view model each time")
    func otherFactoriesAreFresh() {
        let dependencies = makeDependencies()

        #expect(dependencies.makeInboxViewModel() !== dependencies.makeInboxViewModel())
        #expect(dependencies.makeAdminTasksViewModel() !== dependencies.makeAdminTasksViewModel())
    }

    @Test("preferences persist across a fresh read and are shared with the root view model")
    func preferencesAreShared() {
        let store = InMemorySecureStore()
        let dependencies = makeDependencies(secureStore: store)
        let model = RootViewModel(dependencies: dependencies)

        dependencies.preferences.setAnalytics(enabled: true)

        #expect(model.analyticsConsent == .granted)
        #expect(makeDependencies(secureStore: store).preferences.analyticsConsent == .granted)
    }
}
