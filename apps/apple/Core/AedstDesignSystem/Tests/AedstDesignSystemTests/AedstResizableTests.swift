#if os(iOS) || os(macOS) || os(visionOS)
import Testing
@testable import AedstDesignSystem

@Suite("AedstResizable")
struct AedstResizableTests {
    @Test("the fraction stays inside its range")
    func clamps() {
        #expect(AedstResizableMath.clamped(0.05, to: 0.2...0.8) == 0.2)
        #expect(AedstResizableMath.clamped(0.95, to: 0.2...0.8) == 0.8)
        #expect(AedstResizableMath.clamped(0.5, to: 0.2...0.8) == 0.5)
    }

    @Test("dragging moves the divider by the dragged share of the axis")
    func dragging() {
        let moved = AedstResizableMath.fraction(start: 0.5, translation: 100, total: 400, range: 0.2...0.8)
        #expect(abs(moved - 0.75) < 0.0001)
        #expect(AedstResizableMath.fraction(start: 0.5, translation: -400, total: 400, range: 0.2...0.8) == 0.2)
    }

    @Test("a zero-sized container keeps the starting fraction")
    func zeroSize() {
        #expect(AedstResizableMath.fraction(start: 0.4, translation: 50, total: 0, range: 0.2...0.8) == 0.4)
    }
}
#endif
