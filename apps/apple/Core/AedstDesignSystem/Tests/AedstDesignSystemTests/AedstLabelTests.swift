import Testing
@testable import AedstDesignSystem

@Suite("AedstLabel")
struct AedstLabelTests {
    @Test("a required label is read with the word Required instead of an asterisk")
    func requiredLabel() {
        let spoken = AedstLabel.accessibilityText("Email", isRequired: true)
        #expect(spoken.hasPrefix("Email"))
        #expect(spoken.contains(AedstStrings.required))
        #expect(!spoken.contains("*"))
    }

    @Test("an optional label is read as is")
    func optionalLabel() {
        #expect(AedstLabel.accessibilityText("Email", isRequired: false) == "Email")
    }
}
