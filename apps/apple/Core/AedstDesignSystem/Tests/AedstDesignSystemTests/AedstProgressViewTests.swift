import Testing
@testable import AedstDesignSystem

@Suite("AedstProgressView")
struct AedstProgressViewTests {
    @Test("the value is clamped to 0...1 and NaN is indeterminate")
    func clamps() {
        #expect(AedstProgressView.fraction(0.4) == 0.4)
        #expect(AedstProgressView.fraction(-1) == 0)
        #expect(AedstProgressView.fraction(3) == 1)
        #expect(AedstProgressView.fraction(.nan) == nil)
        #expect(AedstProgressView.fraction(nil) == nil)
    }

    @Test("the spoken value is a rounded percentage, none while indeterminate")
    func percent() {
        #expect(AedstProgressView.percentValue(0.605) == AedstStrings.percent(61))
        #expect(AedstProgressView.percentValue(nil) == nil)
    }
}
