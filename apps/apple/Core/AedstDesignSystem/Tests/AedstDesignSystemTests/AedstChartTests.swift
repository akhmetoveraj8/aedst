#if os(iOS) || os(macOS) || os(visionOS)
import Testing
@testable import AedstDesignSystem

@MainActor
@Suite("AedstChart")
struct AedstChartTests {
    @Test("series keep the order of first appearance, which is the order of the colour tokens")
    func seriesOrder() {
        let points = [
            AedstChartPoint(category: "Jan", value: 1, series: "Open"),
            AedstChartPoint(category: "Jan", value: 2, series: "Done"),
            AedstChartPoint(category: "Feb", value: 3, series: "Open"),
        ]
        #expect(AedstChart.seriesNames(in: points) == ["Open", "Done"])
    }

    @Test("points differ by series and by category")
    func pointIdentity() {
        let first = AedstChartPoint(category: "Jan", value: 1, series: "Open")
        #expect(first.id != AedstChartPoint(category: "Feb", value: 1, series: "Open").id)
        #expect(first.id != AedstChartPoint(category: "Jan", value: 1, series: "Done").id)
    }
}
#endif
