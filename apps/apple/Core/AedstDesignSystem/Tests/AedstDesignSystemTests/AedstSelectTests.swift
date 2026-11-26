#if os(iOS) || os(macOS) || os(visionOS)
import SwiftUI
import Testing
@testable import AedstDesignSystem

@Suite("AedstSelect and AedstNativeSelect sizes")
struct AedstSelectTests {
    @Test("sm is shorter than default with a smaller radius on a pointer platform")
    func selectSize() {
        #expect(AedstSelectSize.default.pointerHeight == 32)
        #expect(AedstSelectSize.sm.pointerHeight == 28)
        #expect(AedstSelectSize.sm.cornerRadius < AedstSelectSize.default.cornerRadius)
    }

    @Test("touch platforms keep a 44 pt trigger for both sizes")
    func touchTarget() {
        #if os(macOS)
        #expect(AedstSelectSize.sm.height == 28)
        #else
        for size in AedstSelectSize.allCases {
            #expect(size.height >= AedstHitTarget.minimum)
        }
        #endif
    }

    @Test("the native select maps sm to the small system control")
    func nativeSize() {
        #expect(AedstNativeSelectSize.default.controlSize == .regular)
        #expect(AedstNativeSelectSize.sm.controlSize == .small)
    }
}
#endif
