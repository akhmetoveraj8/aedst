import Testing
@testable import AedstDesignSystem

@Suite("AedstCheckbox")
struct AedstCheckboxTests {
    @Test("VoiceOver hears the checked state, not only the label")
    func accessibilityValue() {
        #expect(AedstCheckbox.accessibilityValue(isChecked: true) == AedstStrings.checked)
        #expect(AedstCheckbox.accessibilityValue(isChecked: false) == AedstStrings.unchecked)
        #expect(AedstStrings.checked != AedstStrings.unchecked)
    }
}
