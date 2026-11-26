#if os(iOS) || os(macOS) || os(visionOS)
import Testing
@testable import AedstDesignSystem

@Suite("AedstField legend variants")
struct AedstFieldTests {
    @Test("a label legend sits closer to its fields than a section legend")
    func spacing() {
        #expect(AedstFieldLegendVariant.label.contentSpacing < AedstFieldLegendVariant.legend.contentSpacing)
    }

    @Test("both legend variants exist, as on web")
    func cases() {
        #expect(AedstFieldLegendVariant.allCases == [.legend, .label])
    }
}
#endif
