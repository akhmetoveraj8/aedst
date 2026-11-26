import SwiftUI
import Testing
@testable import AedstDesignSystem

@Suite("AedstRadioGroup")
struct AedstRadioGroupTests {
    private struct Plan: Hashable, Identifiable {
        let id: String
    }

    @Test("every option is a button and only the chosen one is selected")
    func traits() {
        let selected = AedstRadioGroup<Plan>.traits(isSelected: true)
        let other = AedstRadioGroup<Plan>.traits(isSelected: false)
        #expect(selected.contains(.isButton))
        #expect(selected.contains(.isSelected))
        #expect(other.contains(.isButton))
        #expect(!other.contains(.isSelected))
    }
}
