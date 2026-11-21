#if os(iOS) || os(macOS) || os(visionOS)
import Testing
@testable import AedstDesignSystem

@MainActor
@Suite("AedstPagination")
struct AedstPaginationTests {
    private func items(_ page: Int, of count: Int, siblings: Int = 1) -> [AedstPaginationItem] {
        AedstPagination.items(page: page, pageCount: count, siblingCount: siblings)
    }

    @Test("a short list shows every page and no gap")
    func showsEveryPageWhenShort() {
        #expect(items(2, of: 5) == [.page(1), .page(2), .page(3), .page(4), .page(5)])
        #expect(items(1, of: 7).count == 7)
        #expect(items(1, of: 0).isEmpty)
    }

    @Test("near the start only the trailing gap is shown")
    func gapAtTheEnd() {
        let expected: [AedstPaginationItem] = [
            .page(1), .page(2), .page(3), .page(4), .page(5), .ellipsis(after: 5), .page(10),
        ]
        #expect(items(1, of: 10) == expected)
        #expect(items(3, of: 10) == expected)
    }

    @Test("near the end only the leading gap is shown")
    func gapAtTheStart() {
        let expected: [AedstPaginationItem] = [
            .page(1), .ellipsis(after: 1), .page(6), .page(7), .page(8), .page(9), .page(10),
        ]
        #expect(items(10, of: 10) == expected)
        #expect(items(8, of: 10) == expected)
    }

    @Test("in the middle both gaps surround the current page and its siblings")
    func gapsOnBothSides() {
        let expected: [AedstPaginationItem] = [
            .page(1), .ellipsis(after: 1), .page(4), .page(5), .page(6), .ellipsis(after: 6), .page(10),
        ]
        #expect(items(5, of: 10) == expected)
    }

    @Test("the list keeps a constant length while paging, so the control does not jump")
    func constantLength() {
        for page in 1...20 {
            #expect(items(page, of: 20).count == 7)
            #expect(items(page, of: 20, siblings: 2).count == 9)
        }
    }

    @Test("an out-of-range page is clamped")
    func clampsThePage() {
        #expect(items(99, of: 10) == items(10, of: 10))
        #expect(items(-3, of: 10) == items(1, of: 10))
    }
}
#endif
