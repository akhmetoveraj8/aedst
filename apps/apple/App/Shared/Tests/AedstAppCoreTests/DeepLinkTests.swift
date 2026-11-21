import Foundation
import Testing
@testable import AedstAppShared

@Suite("DeepLink")
struct DeepLinkTests {
    private func parse(_ string: String) -> DeepLink? {
        URL(string: string).flatMap(DeepLink.init(url:))
    }

    @Test("aedst://login is recognised")
    func login() {
        #expect(parse("aedst://login") == .login)
        #expect(parse("AEDST://LOGIN") == .login)
        #expect(parse("aedst://login/") == .login)
    }

    @Test("other schemes, hosts, paths, queries and credentials are rejected")
    func rejectsEverythingElse() {
        #expect(parse("https://login") == nil)
        #expect(parse("aedst://settings") == nil)
        #expect(parse("aedst://login/extra") == nil)
        #expect(parse("aedst://login?next=evil") == nil)
        #expect(parse("aedst://login#frag") == nil)
        #expect(parse("aedst://user:pw@login") == nil)
        #expect(parse("aedst://login:8080") == nil)
        #expect(parse("aedst:login") == nil)
    }
}
