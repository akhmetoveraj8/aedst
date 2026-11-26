import Testing
@testable import AedstDesignSystem

@Suite("AedstCard sizes")
struct AedstCardTests {
    @Test("sm tightens the card spacing from 16 to 12 pt, as web --card-spacing")
    func spacing() {
        #expect(AedstCardSize.default.spacing == AedstSpacing.lg)
        #expect(AedstCardSize.sm.spacing == AedstSpacing.md)
        #expect(AedstCardSize.sm.spacing < AedstCardSize.default.spacing)
    }
}
