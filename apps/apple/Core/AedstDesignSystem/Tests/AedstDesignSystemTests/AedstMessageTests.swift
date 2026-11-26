#if os(iOS) || os(macOS) || os(visionOS)
import SwiftUI
import Testing
@testable import AedstDesignSystem

@Suite("AedstMessage")
struct AedstMessageTests {
    @Test("end messages align to the trailing edge (mirrored in right-to-left), start to the leading edge")
    func alignment() {
        #expect(AedstMessageAlign.end.horizontalAlignment == .trailing)
        #expect(AedstMessageAlign.end.frameAlignment == .trailing)
        #expect(AedstMessageAlign.start.horizontalAlignment == .leading)
        #expect(AedstMessageAlign.start.frameAlignment == .leading)
    }

    @Test("outside a message, bubbles see the start side")
    func defaultSide() {
        #expect(EnvironmentValues().aedstMessageAlign == .start)
    }
}
#endif
