import AedstCore
import Testing
@testable import Admin

@Suite("Admin")
struct AdminTests {
    @Test("broadcast validation mirrors the proto rules")
    func broadcastValidation() {
        #expect(Broadcast(title: "Maintenance tonight").isValid)
        #expect(!Broadcast(title: "  ").isValid)
        #expect(!Broadcast(title: String(repeating: "x", count: 121)).isValid)
        #expect(Broadcast(title: "Hi", link: "/tasks").isValid)
        #expect(!Broadcast(title: "Hi", link: "https://evil.example").isValid)
        #expect(!Broadcast(title: "Hi", link: "//evil.example").isValid)
    }

    @Test("status 3 is TASK_STATUS_DONE")
    func taskStatus() {
        #expect(AdminTask(id: "1", ownerID: "u", title: "t", status: 3, createdAt: nil).isDone)
    }
}

@Suite("Admin models")
struct AdminModelTests {
    @Test("broadcast limits: title 120, body 1000, link 500 and relative only")
    func broadcastLimits() {
        #expect(Broadcast(title: String(repeating: "x", count: 120)).isValid)
        #expect(Broadcast(title: "t", body: String(repeating: "x", count: 1_000)).isValid)
        #expect(!Broadcast(title: "t", body: String(repeating: "x", count: 1_001)).isValid)
        #expect(Broadcast(title: "t", link: "/" + String(repeating: "x", count: 499)).isValid)
        #expect(!Broadcast(title: "t", link: "/" + String(repeating: "x", count: 500)).isValid)
        #expect(!Broadcast(title: "t", link: "tasks/1").isValid)
    }

    @Test("PagedList.apply replaces on the first page and appends afterwards")
    func pagedList() {
        var list = PagedList<Int>()
        #expect(!list.hasLoaded)

        list.apply(Page(items: [1, 2], nextPageToken: "n"), replacing: true)
        list.apply(Page(items: [3], nextPageToken: nil), replacing: false)

        #expect(list.items == [1, 2, 3])
        #expect(list.nextPageToken == nil)
        #expect(list.hasLoaded)
    }
}
