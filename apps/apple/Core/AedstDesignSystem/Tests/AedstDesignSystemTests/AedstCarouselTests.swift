#if os(iOS) || os(macOS) || os(visionOS)
import Testing
@testable import AedstDesignSystem

@Suite("AedstCarousel")
struct AedstCarouselTests {
    @Test("the slide index stays inside the slides")
    func clampsIndex() {
        #expect(AedstCarouselIndex.clamped(-1, count: 5) == 0)
        #expect(AedstCarouselIndex.clamped(7, count: 5) == 4)
        #expect(AedstCarouselIndex.clamped(2, count: 5) == 2)
        #expect(AedstCarouselIndex.clamped(3, count: 0) == 0)
    }
}
#endif
