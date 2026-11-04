import Testing
@testable import AedstDesignSystem

@Suite("AedstSpacing")
struct AedstSpacingTests {
    @Test("scale is strictly increasing")
    func strictlyIncreasing() {
        let scale = [AedstSpacing.xs, AedstSpacing.sm, AedstSpacing.md, AedstSpacing.lg, AedstSpacing.xl, AedstSpacing.xxl]
        #expect(scale == scale.sorted())
        #expect(Set(scale).count == scale.count)
    }
}
