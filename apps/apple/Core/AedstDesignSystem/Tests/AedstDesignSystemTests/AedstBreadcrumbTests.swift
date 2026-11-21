#if os(iOS) || os(macOS) || os(visionOS)
import Testing
@testable import AedstDesignSystem

@MainActor
@Suite("AedstBreadcrumb")
struct AedstBreadcrumbTests {
    @Test("a trail that fits is not collapsed")
    func fits() {
        #expect(AedstBreadcrumb.collapsedRange(count: 4, maxVisible: 4) == nil)
        #expect(AedstBreadcrumb.collapsedRange(count: 0, maxVisible: 4) == nil)
    }

    @Test("a long trail keeps the root and the last levels")
    func collapsesTheMiddle() {
        #expect(AedstBreadcrumb.collapsedRange(count: 6, maxVisible: 4) == 1..<3)
        #expect(AedstBreadcrumb.collapsedRange(count: 5, maxVisible: 3) == 1..<3)
    }

    @Test("at least the root and the current page stay visible")
    func minimumVisible() {
        #expect(AedstBreadcrumb.collapsedRange(count: 5, maxVisible: 0) == 1..<4)
    }
}
#endif
