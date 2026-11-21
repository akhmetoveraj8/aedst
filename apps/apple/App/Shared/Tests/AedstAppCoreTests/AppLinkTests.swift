import Testing
@testable import AedstAppShared

@Suite("AppLink")
struct AppLinkTests {
    @Test("server links map to app sections")
    func parses() {
        #expect(AppLink(path: "/tasks") == .tasks)
        #expect(AppLink(path: "/tasks/3f2a-9c_1") == .task(id: "3f2a-9c_1"))
        #expect(AppLink(path: "/media/abc") == .mediaItem(id: "abc"))
        #expect(AppLink(path: "/notifications?from=push") == .notifications)
        #expect(AppLink(path: "/admin") == .admin)
    }

    @Test("absolute, protocol-relative, unknown and malformed links are rejected")
    func rejects() {
        #expect(AppLink(path: "https://evil.example/tasks") == nil)
        #expect(AppLink(path: "//evil.example/tasks") == nil)
        #expect(AppLink(path: "/billing") == nil)
        #expect(AppLink(path: "/tasks/1/2") == nil)
        #expect(AppLink(path: "/tasks/<script>") == nil)
        #expect(AppLink(path: "tasks/1") == nil)
    }
}
