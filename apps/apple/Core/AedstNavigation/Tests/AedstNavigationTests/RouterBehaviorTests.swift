import Observation
import Testing
@testable import AedstNavigation

private enum FeatureARoute: AedstRoute {
    case list
    case detail(id: String)
}

private enum FeatureBRoute: AedstRoute {
    case settings
}

/// Mutable flag for `withObservationTracking`'s `@Sendable` `onChange` closure.
private final class ChangeFlag: @unchecked Sendable {
    var didChange = false
}

@Suite("Router behaviour")
@MainActor
struct RouterBehaviorTests {
    @Test("routes of different feature types share one stack")
    func mixedRouteTypes() {
        let router = Router()

        router.push(FeatureARoute.detail(id: "1"))
        router.push(FeatureBRoute.settings)
        router.push(FeatureARoute.list)

        #expect(router.path.count == 3)
        router.pop()
        #expect(router.path.count == 2)
    }

    @Test("replace on an empty stack just pushes")
    func replaceOnEmpty() {
        let router = Router()

        router.replace(with: FeatureARoute.list)

        #expect(router.path.count == 1)
    }

    @Test("replace discards the whole previous stack, not only the top")
    func replaceDiscardsEverything() {
        let router = Router()
        router.push(FeatureARoute.list)
        router.push(FeatureARoute.detail(id: "1"))
        router.push(FeatureBRoute.settings)

        router.replace(with: FeatureBRoute.settings)

        #expect(router.path.count == 1)
    }

    @Test("popping more often than pushing never goes below empty")
    func overPop() {
        let router = Router()
        router.push(FeatureARoute.list)

        router.pop()
        router.pop()
        router.pop()

        #expect(router.path.isEmpty)
    }

    @Test("popToRoot is idempotent")
    func popToRootTwice() {
        let router = Router()
        router.push(FeatureARoute.list)

        router.popToRoot()
        router.popToRoot()

        #expect(router.path.isEmpty)
    }

    @Test("a push notifies observers of `path` (this is what re-renders the stack)")
    func pushIsObservable() {
        let router = Router()
        let flag = ChangeFlag()
        withObservationTracking {
            _ = router.path
        } onChange: {
            flag.didChange = true
        }

        router.push(FeatureARoute.list)

        #expect(flag.didChange)
    }

    @Test("equal route values hash equal, different payloads do not")
    func routeValueSemantics() {
        #expect(FeatureARoute.detail(id: "1") == FeatureARoute.detail(id: "1"))
        #expect(FeatureARoute.detail(id: "1") != FeatureARoute.detail(id: "2"))
        #expect(Set([FeatureARoute.list, FeatureARoute.list, FeatureARoute.detail(id: "1")]).count == 2)
    }
}
