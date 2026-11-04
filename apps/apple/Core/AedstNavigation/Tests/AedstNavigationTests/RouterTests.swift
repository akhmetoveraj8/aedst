import Foundation
import Testing
@testable import AedstNavigation

private enum TestRoute: AedstRoute {
    case a, b
}

@Suite("Router")
@MainActor
struct RouterTests {
    @Test("push increases path count")
    func push() {
        let router = Router()
        router.push(TestRoute.a)
        router.push(TestRoute.b)
        #expect(router.path.count == 2)
    }

    @Test("popToRoot empties the path")
    func popToRoot() {
        let router = Router()
        router.push(TestRoute.a)
        router.push(TestRoute.b)
        router.popToRoot()
        #expect(router.path.isEmpty)
    }

    @Test("pop removes exactly one route")
    func popRemovesOne() {
        let router = Router()
        router.push(TestRoute.a)
        router.push(TestRoute.b)
        router.pop()
        #expect(router.path.count == 1)
    }

    @Test("replace leaves exactly one route")
    func replaceLeavesOne() {
        let router = Router()
        router.push(TestRoute.a)
        router.push(TestRoute.a)
        router.replace(with: TestRoute.b)
        #expect(router.path.count == 1)
    }

    @Test("pop on empty path is a no-op")
    func popOnEmpty() {
        let router = Router()
        router.pop()
        #expect(router.path.isEmpty)
    }
}

@Suite("Router restoration")
@MainActor
struct RouterRestorationTests {
    @Test("a pushed stack survives encode and restore")
    func roundTrip() throws {
        let router = Router()
        router.push(TaskRoute.list)
        router.push(TaskRoute.detail(id: "t-1"))
        let data = try #require(router.persistedData())

        let restored = Router()
        #expect(restored.restore(from: data))

        #expect(restored.path.count == 2)
        #expect(restored.persistedData() == data)
    }

    @Test("an empty stack persists nothing")
    func emptyPersistsNothing() {
        #expect(Router().persistedData() == nil)
    }

    @Test("garbage or missing data leaves the stack untouched")
    func garbageIsIgnored() {
        let router = Router()
        router.push(MediaRoute.library)

        #expect(!router.restore(from: nil))
        #expect(!router.restore(from: Data("not json".utf8)))
        #expect(router.path.count == 1)
    }
}
