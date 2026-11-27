import Testing
@testable import AedstDesignSystem

@Suite("AedstSwitch sizes")
struct AedstSwitchTests {
    @Test("default and sm match the web track sizes")
    func track() {
        #expect(AedstSwitchSize.default.track.width == 32)
        #expect(AedstSwitchSize.default.track.height == 18)
        #expect(AedstSwitchSize.sm.track.width == 24)
        #expect(AedstSwitchSize.sm.track.height == 14)
    }

    @Test("the thumb fits inside the track and travels to its other end")
    func thumb() {
        for size in AedstSwitchSize.allCases {
            #expect(size.thumb < size.track.height)
            #expect(size.travel + size.thumb + 2 * AedstSwitchSize.thumbInset == size.track.width)
        }
    }
}
