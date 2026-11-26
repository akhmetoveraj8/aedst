#if os(iOS) || os(macOS) || os(visionOS)
import Foundation
import Testing
@testable import AedstDesignSystem

@Suite("AedstAiSources")
@MainActor
struct AedstAiSourcesTests {
    private let url = URL(string: "https://www.example.com/docs") ?? URL(filePath: "/")

    @Test("a source without a title shows its host name")
    func fallbackTitle() {
        #expect(AedstAiSource(href: url).displayTitle == "example.com")
        #expect(AedstAiSource(href: url, title: "Docs").displayTitle == "Docs")
    }

    @Test("the list builds on the kit collapsible")
    func builds() {
        _ = AedstAiSources {
            AedstAiSourcesTrigger("Used 1 source")
        } content: {
            AedstAiSourcesContent { AedstAiSource(href: url) }
        }.body
    }
}
#endif
