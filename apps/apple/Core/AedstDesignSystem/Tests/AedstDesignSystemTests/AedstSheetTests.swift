import SwiftUI
import Testing
@testable import AedstDesignSystem

@Suite("AedstSheet")
struct AedstSheetTests {
    @Test("the kit detents map to the system's half and full height")
    func detents() {
        #expect(AedstSheetDetent.medium.presentationDetent == .medium)
        #expect(AedstSheetDetent.large.presentationDetent == .large)
    }
}
