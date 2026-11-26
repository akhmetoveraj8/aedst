#if os(iOS) || os(macOS) || os(visionOS)
import Testing
@testable import AedstDesignSystem

@Suite("AedstMarker")
struct AedstMarkerTests {
    @Test("separator draws rules on both sides, border a rule underneath, default neither")
    func rules() {
        #expect(AedstMarkerVariant.separator.drawsSideRules)
        #expect(!AedstMarkerVariant.separator.drawsBottomRule)
        #expect(AedstMarkerVariant.border.drawsBottomRule)
        #expect(!AedstMarkerVariant.border.drawsSideRules)
        #expect(!AedstMarkerVariant.default.drawsSideRules)
        #expect(!AedstMarkerVariant.default.drawsBottomRule)
    }
}
#endif
