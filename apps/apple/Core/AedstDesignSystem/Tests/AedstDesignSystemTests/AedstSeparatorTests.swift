import Testing
@testable import AedstDesignSystem

@Suite("AedstSeparator")
struct AedstSeparatorTests {
    @Test("a horizontal rule is 1 pt tall and as wide as its container")
    func horizontal() {
        let size = AedstSeparator.frame(for: .horizontal)
        #expect(size.width == nil)
        #expect(size.height == 1)
    }

    @Test("a vertical rule is 1 pt wide and as tall as its container")
    func vertical() {
        let size = AedstSeparator.frame(for: .vertical)
        #expect(size.width == 1)
        #expect(size.height == nil)
    }
}
